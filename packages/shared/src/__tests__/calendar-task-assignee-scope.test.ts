import { describe, expect, it } from "vitest";
import {
  calendarForCacheKey,
  calendarTaskAssigneeWhere,
  canInspectWorkspaceCalendars,
} from "../calendar/calendar-task-assignee-scope.js";

describe("calendarTaskAssigneeWhere", () => {
  it("My Calendar → assignee = current user", () => {
    expect(
      calendarTaskAssigneeWhere({
        calendarFor: "ME",
        currentUserId: "kerri",
        canInspectWorkspace: false,
      })
    ).toEqual({ assigneeUserId: "kerri" });
  });

  it("requester is irrelevant — Kerri assignee only", () => {
    // Calendar ownership is assignee-only; Reese as requester never enters this where.
    const kerri = calendarTaskAssigneeWhere({
      calendarFor: "ME",
      currentUserId: "kerri",
      canInspectWorkspace: false,
    });
    const reese = calendarTaskAssigneeWhere({
      calendarFor: "ME",
      currentUserId: "reese",
      canInspectWorkspace: false,
    });
    expect(kerri).toEqual({ assigneeUserId: "kerri" });
    expect(reese).toEqual({ assigneeUserId: "reese" });
    expect(kerri).not.toEqual(reese);
  });

  it("self-assigned appears once under ME (no requester duplication)", () => {
    expect(
      calendarTaskAssigneeWhere({
        calendarFor: "ME",
        currentUserId: "reese",
        canInspectWorkspace: false,
      })
    ).toEqual({ assigneeUserId: "reese" });
  });

  it("unassigned not on personal calendar", () => {
    expect(
      calendarTaskAssigneeWhere({
        calendarFor: "ME",
        currentUserId: "reese",
        canInspectWorkspace: false,
      })
    ).toEqual({ assigneeUserId: "reese" });
  });

  it("Owner/Admin Unassigned view", () => {
    expect(
      calendarTaskAssigneeWhere({
        calendarFor: "UNASSIGNED",
        currentUserId: "admin",
        canInspectWorkspace: true,
      })
    ).toEqual({ assigneeUserId: null });
  });

  it("Owner/Admin All users has no assignee predicate", () => {
    expect(
      calendarTaskAssigneeWhere({
        calendarFor: "ALL",
        currentUserId: "admin",
        canInspectWorkspace: true,
      })
    ).toEqual({});
  });

  it("Owner/Admin Calendar for Kerri", () => {
    expect(
      calendarTaskAssigneeWhere({
        calendarFor: "kerri",
        currentUserId: "admin",
        canInspectWorkspace: true,
      })
    ).toEqual({ assigneeUserId: "kerri" });
  });

  it("MEMBER cannot broaden scope via helper (defense in depth)", () => {
    expect(
      calendarTaskAssigneeWhere({
        calendarFor: "kerri",
        currentUserId: "reese",
        canInspectWorkspace: false,
      })
    ).toEqual({ assigneeUserId: "reese" });
  });
});

describe("canInspectWorkspaceCalendars", () => {
  it("OWNER and ADMIN only", () => {
    expect(canInspectWorkspaceCalendars("OWNER")).toBe(true);
    expect(canInspectWorkspaceCalendars("ADMIN")).toBe(true);
    expect(canInspectWorkspaceCalendars("MANAGER")).toBe(false);
    expect(canInspectWorkspaceCalendars("MEMBER")).toBe(false);
    expect(canInspectWorkspaceCalendars("VIEWER")).toBe(false);
  });
});

describe("calendarForCacheKey", () => {
  it("distinguishes My / Kerri / Reese / All / Unassigned", () => {
    const keys = [
      calendarForCacheKey("ME"),
      calendarForCacheKey("kerri"),
      calendarForCacheKey("reese"),
      calendarForCacheKey("ALL"),
      calendarForCacheKey("UNASSIGNED"),
    ];
    expect(new Set(keys).size).toBe(5);
  });
});
