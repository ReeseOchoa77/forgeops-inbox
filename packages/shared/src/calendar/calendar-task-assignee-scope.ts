/**
 * User-scoped Task calendar ownership.
 *
 * Task due dates are projected from Task.dueAt + Task.assigneeUserId.
 * Requester is intentionally ignored for Calendar ownership.
 */

import type { Prisma } from "@prisma/client";

/** Calendar for filter values (API query). */
export type CalendarForScope = "ME" | "ALL" | "UNASSIGNED" | string;

export function canInspectWorkspaceCalendars(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Prisma fragment for Task-derived calendar items.
 * Returns null when no assignee predicate should be added (invalid — callers must resolve).
 */
export function calendarTaskAssigneeWhere(input: {
  calendarFor: CalendarForScope;
  currentUserId: string;
  canInspectWorkspace: boolean;
}): Prisma.TaskWhereInput {
  const scope = input.calendarFor || "ME";

  if (scope === "ME") {
    return { assigneeUserId: input.currentUserId };
  }

  if (!input.canInspectWorkspace) {
    // Defense in depth: non-admin always locked to own assignee.
    return { assigneeUserId: input.currentUserId };
  }

  if (scope === "UNASSIGNED") {
    return { assigneeUserId: null };
  }

  if (scope === "ALL") {
    // Assigned + unassigned workspace Task deadlines.
    return {};
  }

  // Concrete user id
  return { assigneeUserId: scope };
}

/** Cache/query identity fragment for Calendar feeds. */
export function calendarForCacheKey(calendarFor: CalendarForScope): string {
  return `calendarFor:${calendarFor || "ME"}`;
}
