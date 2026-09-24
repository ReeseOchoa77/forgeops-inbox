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
