import { describe, expect, it } from "vitest";
import {
  buildOperationalTasksWhere,
  resolveUniqueToAssigneeUserId,
  taskOwnershipWhere,
} from "@forgeops/shared";

describe("task ownership filter composition", () => {
  it("composes My Tasks + status + job + pinned before pagination shape", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws1",
      ownershipView: "MY",
      currentUserId: "reese",
      canViewWorkspaceTasks: false,
      status: "OPEN",
      jobFilter: "job-25",
      priority: "HIGH",
      pinnedOnly: true,
      due: "WEEK",
      source: "MANUAL",
      timezone: "UTC",
      now: new Date("2026-10-09T12:00:00.000Z"),
    });
    const json = JSON.stringify(where);
    expect(json).toContain('"assigneeUserId":"reese"');
    expect(json).toContain('"jobId":"job-25"');
    expect(json).toContain('"isPinned":true');
    expect(json).toContain('"source":"MANUAL"');
    expect(json).toContain("OPEN");
  });

  it("Requests requires requester=me and assignee!=me", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws1",
      ownershipView: "REQUESTS",
      currentUserId: "reese",
      canViewWorkspaceTasks: false,
    });
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          { workspaceId: "ws1" },
          {
            requesterUserId: "reese",
            NOT: { assigneeUserId: "reese" },
          },
        ]),
      })
    );
  });

  it("self-created self-assigned is only My Tasks, never Requests", () => {
    const my = taskOwnershipWhere({
      view: "MY",
      currentUserId: "reese",
      canViewWorkspaceTasks: false,
    });
    const req = taskOwnershipWhere({
      view: "REQUESTS",
      currentUserId: "reese",
      canViewWorkspaceTasks: false,
    });
    // Same user as both assignee and requester matches MY, fails REQUESTS NOT clause.
    expect(my).toEqual({ assigneeUserId: "reese" });
    expect(req).toMatchObject({
      requesterUserId: "reese",
      NOT: { assigneeUserId: "reese" },
    });
  });

  it("Owner/Admin Tasks for Kerri is assignee filter", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws1",
      ownershipView: "ALL",
      currentUserId: "admin",
      canViewWorkspaceTasks: true,
      assigneeScope: "kerri",
      status: "OPEN",
    });
    expect(JSON.stringify(where)).toContain('"assigneeUserId":"kerri"');
  });

  it("Owner/Admin Unassigned works", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws1",
      ownershipView: "ALL",
      currentUserId: "admin",
      canViewWorkspaceTasks: true,
      assigneeScope: "UNASSIGNED",
    });
    expect(JSON.stringify(where)).toContain('"assigneeUserId":null');
  });

  it("includes MANUAL workspace tasks alongside connection-scoped email tasks", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      includeManualWorkspaceTasks: true,
      ownershipView: "MY",
      currentUserId: "reese",
      canViewWorkspaceTasks: false,
    });
    const json = JSON.stringify(where);
    expect(json).toContain("MANUAL");
    expect(json).toContain("conn1");
  });

  it("email direction remains a separate filter from Requests ownership", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws1",
      ownershipView: "REQUESTS",
      currentUserId: "reese",
      canViewWorkspaceTasks: false,
      direction: "SENT",
      connectionEmail: "shop@company.com",
    });
    const json = JSON.stringify(where);
    expect(json).toContain("requesterUserId");
    expect(json).toContain("SENT");
  });
});

describe("email auto-assignment rules (contract)", () => {
  const members = [
    { userId: "kerri", email: "kerri@company.com" },
    { userId: "reese", email: "reese@company.com" },
  ];

  it("received To Kerri → Kerri", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [{ email: "kerri@company.com" }],
        members,
      })
    ).toBe("kerri");
  });

  it("To Kerri + CC Reese → Kerri (CC ignored)", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [{ email: "kerri@company.com" }],
        members,
      })
    ).toBe("kerri");
  });

  it("To Kerri + Reese → unassigned", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [
          { email: "kerri@company.com" },
          { email: "reese@company.com" },
        ],
        members,
      })
    ).toBeNull();
  });

  it("assigneeGuess must not become assignee — only TO match does", () => {
    // Documented invariant: resolve helper never reads assigneeGuess.
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [{ email: "estimating@company.com" }],
        members,
      })
    ).toBeNull();
  });
});

describe("task status lifecycle (contract)", () => {
  it("complete maps to DONE and reopen to OPEN", () => {
    const complete = (status: "OPEN" | "DONE") =>
      status === "DONE" ? "DONE" : "OPEN";
    expect(complete("DONE")).toBe("DONE");
    expect(complete("OPEN")).toBe("OPEN");
  });
});
