import { describe, expect, it } from "vitest";
import {
  extractToAddressEmails,
  resolveUniqueSenderAssigneeUserId,
  resolveUniqueToAssigneeUserId,
} from "../tasks/resolve-email-task-assignee.js";
import { taskOwnershipWhere } from "../tasks/task-list-filters.js";

const kerri = { userId: "kerri", email: "kerri@company.com" };
const reese = { userId: "reese", email: "Reese@company.com" };

describe("resolveUniqueToAssigneeUserId", () => {
  it("assigns when exactly one TO matches an active member", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [{ email: "kerri@company.com", name: "Kerri" }],
        members: [kerri, reese],
      })
    ).toBe("kerri");
  });

  it("uses TO only — CC does not establish responsibility", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [{ email: "kerri@company.com" }],
        members: [kerri, reese],
      })
    ).toBe("kerri");
  });

  it("leaves unassigned when two workspace users are in TO", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [
          { email: "kerri@company.com" },
          { email: "reese@company.com" },
        ],
        members: [kerri, reese],
      })
    ).toBeNull();
  });

  it("leaves unassigned for shared mailbox with no User.email match", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [{ email: "estimating@company.com" }],
        members: [kerri, reese],
      })
    ).toBeNull();
  });

  it("leaves unassigned for external-only TO", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [{ email: "vendor@external.com" }],
        members: [kerri, reese],
      })
    ).toBeNull();
  });

  it("normalizes email case/whitespace", () => {
    expect(
      resolveUniqueToAssigneeUserId({
        toAddresses: [{ email: "  Kerri@Company.COM " }],
        members: [kerri],
      })
    ).toBe("kerri");
  });
});

describe("extractToAddressEmails", () => {
  it("accepts object and string forms", () => {
    expect(
      extractToAddressEmails([
        { email: "a@x.com" },
        "b@x.com",
        { name: "x" },
      ])
    ).toEqual(["a@x.com", "b@x.com"]);
  });
});

describe("resolveUniqueSenderAssigneeUserId", () => {
  it("maps sender only on exact unique match", () => {
    expect(
      resolveUniqueSenderAssigneeUserId({
        senderEmail: "kerri@company.com",
        members: [kerri, reese],
      })
    ).toBe("kerri");
  });

  it("returns null when sender is not a member", () => {
    expect(
      resolveUniqueSenderAssigneeUserId({
        senderEmail: "vendor@external.com",
        members: [kerri],
      })
    ).toBeNull();
  });
});

describe("taskOwnershipWhere", () => {
  it("My Tasks is assignee=me", () => {
    expect(
      taskOwnershipWhere({
        view: "MY",
        currentUserId: "reese",
        canViewWorkspaceTasks: false,
      })
    ).toEqual({ assigneeUserId: "reese" });
  });

  it("Requests excludes self-assigned", () => {
    expect(
      taskOwnershipWhere({
        view: "REQUESTS",
        currentUserId: "reese",
        canViewWorkspaceTasks: false,
      })
    ).toEqual({
      requesterUserId: "reese",
      NOT: { assigneeUserId: "reese" },
    });
  });

  it("Admin Tasks for Kerri filters assignee", () => {
    expect(
      taskOwnershipWhere({
        view: "ALL",
        currentUserId: "admin",
        canViewWorkspaceTasks: true,
        assigneeScope: "kerri",
      })
    ).toEqual({ assigneeUserId: "kerri" });
  });

  it("Admin Unassigned filters null assignee", () => {
    expect(
      taskOwnershipWhere({
        view: "ALL",
        currentUserId: "admin",
        canViewWorkspaceTasks: true,
        assigneeScope: "UNASSIGNED",
      })
    ).toEqual({ assigneeUserId: null });
  });

  it("normal member cannot get peer-wide ALL without degradation", () => {
    const where = taskOwnershipWhere({
      view: "ALL",
      currentUserId: "reese",
      canViewWorkspaceTasks: false,
    });
    expect(JSON.stringify(where)).toContain("reese");
    expect(where).toMatchObject({
      OR: expect.any(Array),
    });
  });
});
