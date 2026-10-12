import { describe, expect, it } from "vitest";
import {
  calendarIneligibleBiddingTaskWhere,
  calendarTaskAssigneeWhere,
  canInspectWorkspaceCalendars,
  isTaskEligibleForCalendar,
} from "@forgeops/shared";

/**
 * Compose the same Task where shape as calendar.route.ts:
 * dueAt range + status + assignee scope + bidding exclusion.
 */
function buildCalendarTaskWhere(input: {
  workspaceId: string;
  from: Date;
  to: Date;
  calendarFor: string;
  currentUserId: string;
  role: string;
}) {
  const canInspect = canInspectWorkspaceCalendars(input.role);
  const assigneeWhere = calendarTaskAssigneeWhere({
    calendarFor: input.calendarFor,
    currentUserId: input.currentUserId,
    canInspectWorkspace: canInspect,
  });
  return {
    workspaceId: input.workspaceId,
    dueAt: { gte: input.from, lt: input.to },
    status: { notIn: ["CANCELLED"] },
    dismissedAt: null,
    ...assigneeWhere,
    NOT: calendarIneligibleBiddingTaskWhere(),
  };
}

describe("calendar task ownership (API contract)", () => {
  const from = new Date("2026-10-01T00:00:00.000Z");
  const to = new Date("2026-11-01T00:00:00.000Z");

  it("Kerri assignee due → Kerri ME calendar where", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "ME",
      currentUserId: "kerri",
      role: "MEMBER",
    });
    expect(where.assigneeUserId).toBe("kerri");
    expect(JSON.stringify(where)).toContain("dueAt");
  });

  it("same Task not on Reese ME calendar", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "ME",
      currentUserId: "reese",
      role: "MEMBER",
    });
    expect(where.assigneeUserId).toBe("reese");
    expect(where.assigneeUserId).not.toBe("kerri");
  });

  it("Reese requester / Kerri assignee → Kerri Calendar only", () => {
    // No requesterUserId predicate anywhere in calendar task where.
    const kerri = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "ME",
      currentUserId: "kerri",
      role: "MEMBER",
    });
    expect(JSON.stringify(kerri)).not.toContain("requesterUserId");
    expect(kerri.assigneeUserId).toBe("kerri");
  });

  it("unassigned Task excluded from personal ME calendar", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "ME",
      currentUserId: "reese",
      role: "MEMBER",
    });
    expect(where.assigneeUserId).toBe("reese");
  });

  it("Owner Unassigned sees null assignee", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "UNASSIGNED",
      currentUserId: "admin",
      role: "OWNER",
    });
    expect(where.assigneeUserId).toBeNull();
  });

  it("Owner All users has no assigneeUserId key", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "ALL",
      currentUserId: "admin",
      role: "ADMIN",
    });
    expect("assigneeUserId" in where).toBe(false);
  });

  it("Owner Calendar for Kerri", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "kerri",
      currentUserId: "admin",
      role: "OWNER",
    });
    expect(where.assigneeUserId).toBe("kerri");
  });

  it("MEMBER role cannot inspect Kerri via calendarFor helper", () => {
    expect(canInspectWorkspaceCalendars("MEMBER")).toBe(false);
    const where = calendarTaskAssigneeWhere({
      calendarFor: "kerri",
      currentUserId: "reese",
      canInspectWorkspace: false,
    });
    expect(where).toEqual({ assigneeUserId: "reese" });
  });

  it("MANAGER follows MEMBER (not Admin calendar inspection)", () => {
    expect(canInspectWorkspaceCalendars("MANAGER")).toBe(false);
  });

  it("reassignment Kerri → Reese is just assigneeUserId change (projection)", () => {
    const before = calendarTaskAssigneeWhere({
      calendarFor: "ME",
      currentUserId: "kerri",
      canInspectWorkspace: false,
    });
    const after = calendarTaskAssigneeWhere({
      calendarFor: "ME",
      currentUserId: "reese",
      canInspectWorkspace: false,
    });
    expect(before).toEqual({ assigneeUserId: "kerri" });
    expect(after).toEqual({ assigneeUserId: "reese" });
  });

  it("Task without dueAt is outside dueAt range (no calendar event)", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "ME",
      currentUserId: "kerri",
      role: "MEMBER",
    });
    expect(where.dueAt).toEqual({ gte: from, lt: to });
  });

  it("completed Tasks remain eligible (CANCELLED excluded only)", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "ME",
      currentUserId: "kerri",
      role: "MEMBER",
    });
    expect(where.status).toEqual({ notIn: ["CANCELLED"] });
  });

  it("preserves bidding exclusion alongside assignee filter", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "ME",
      currentUserId: "kerri",
      role: "MEMBER",
    });
    expect(where.NOT).toEqual(calendarIneligibleBiddingTaskWhere());
    // Unassigned bidding email still ineligible via shared helper.
    expect(
      isTaskEligibleForCalendar({
        classification: { businessTypeKey: "BID_OPPORTUNITY" },
        sourceMessage: {
          id: "m",
          jobId: null,
          classifications: [{ businessTypeKey: "BID_OPPORTUNITY" }],
        },
      })
    ).toBe(false);
  });

  it("assignee filter applies before overfetch (dueAt + assignee in same where)", () => {
    const where = buildCalendarTaskWhere({
      workspaceId: "ws",
      from,
      to,
      calendarFor: "kerri",
      currentUserId: "admin",
      role: "ADMIN",
    });
    expect(where.dueAt).toBeDefined();
    expect(where.assigneeUserId).toBe("kerri");
    expect(where.workspaceId).toBe("ws");
  });
});
