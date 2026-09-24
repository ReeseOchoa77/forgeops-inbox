import type { Prisma } from "@prisma/client";

const OPEN_TASK_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED"] as const;

export type JobListQueryInput = {
  workspaceId: string;
  status?: string;
  customerId?: string;
  search?: string;
  showArchived?: boolean;
  assignedUserId?: string;
  hasOverdueTasks?: boolean;
  now: Date;
};

/**
 * Jobs list filter. Search stays an OR of case-insensitive contains on
 * job number, name, and description — the same fields the list has always searched.
 * Customer name and aliases are not part of this predicate.
 * Workspace id is always required so one workspace cannot see another's jobs.
 */
export function buildJobListWhere(input: JobListQueryInput): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = { workspaceId: input.workspaceId };

  if (input.status) {
    where.status = input.status as NonNullable<Prisma.JobWhereInput["status"]>;
  }
  if (input.customerId) where.customerId = input.customerId;
  if (!input.showArchived) where.archivedAt = null;

  const term = input.search?.trim();
  if (term) {
    where.OR = [
      { jobNumber: { contains: term, mode: "insensitive" } },
      { name: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
    ];
  }

  if (input.assignedUserId) {
    where.members = { some: { userId: input.assignedUserId } };
  }
  if (input.hasOverdueTasks) {
    where.tasks = {
      some: {
        status: { in: [...OPEN_TASK_STATUSES] },
        dueAt: { lt: input.now },
      },
    };
  }

  return where;
}

/**
 * Server-side jobs list order. Applied on the same query as skip/take.
 * Name sorts on normalizedName. Activity reuses updatedAt, which the list
 * already exposes as lastActivityAt. Null start dates and costs sort last.
 * Default remains createdAt descending.
 */
export function jobListOrderBy(
  sortBy: string,
  sortDir: "asc" | "desc",
): Prisma.JobOrderByWithRelationInput[] {
  const nullsLast = { sort: sortDir, nulls: "last" as const };
  switch (sortBy) {
    case "name":
      return [{ normalizedName: sortDir }, { id: "asc" }];
    case "activity":
    case "updatedAt":
      return [{ updatedAt: sortDir }, { id: "asc" }];
    case "startDate":
      return [{ startDate: nullsLast }, { id: "asc" }];
    case "totalCost":
      return [{ totalCost: nullsLast }, { id: "asc" }];
    case "targetCompletionDate":
      return [{ targetCompletionDate: nullsLast }, { id: "asc" }];
    case "jobNumber":
      return [{ jobNumber: nullsLast }, { id: "asc" }];
    case "status":
      return [{ status: sortDir }, { id: "asc" }];
    case "createdAt":
    default:
      return [{ createdAt: sortDir }, { id: "asc" }];
  }
}
