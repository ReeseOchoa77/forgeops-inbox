/**
 * Server-side Task list filter composition (Inbox-aligned vocabulary).
 *
 * Provenance: Task.sourceMessageId → EmailMessage (never denormalize email fields onto Task).
 * Bidding: unassigned bidding-related source emails are excluded from the default
 * operational Tasks view (see operationalUnassignedBiddingTaskWhere).
 */

import type { Prisma } from "@prisma/client";
import {
  biddingRelatedTaskProvenanceWhere,
} from "../calendar/bidding-calendar-inclusion.js";
import {
  addDaysYmd,
  startOfMonthYmd,
  startOfWeekSundayYmd,
  zonedStartOfDay,
  zonedYmd,
} from "../date-bounds.js";

export const TASK_STATUS_FILTERS = ["OPEN", "COMPLETED", "ALL"] as const;
export type TaskStatusFilter = (typeof TASK_STATUS_FILTERS)[number];

export const TASK_DUE_FILTERS = [
  "ALL",
  "OVERDUE",
  "TODAY",
  "WEEK",
  "MONTH",
  "NONE",
] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

export const TASK_PRIORITY_FILTERS = [
  "ALL",
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;
export type TaskPriorityFilter = (typeof TASK_PRIORITY_FILTERS)[number];

export const TASK_SOURCE_FILTERS = ["ALL", "EMAIL", "MANUAL"] as const;
export type TaskSourceFilter = (typeof TASK_SOURCE_FILTERS)[number];

export const TASK_EMAIL_CLASSIFICATION_FILTERS = [
  "ALL",
  "BUSINESS",
  "PERSONAL",
  "UNCLASSIFIED",
] as const;
export type TaskEmailClassificationFilter =
  (typeof TASK_EMAIL_CLASSIFICATION_FILTERS)[number];

export const TASK_DIRECTION_FILTERS = ["ALL", "INCOMING", "SENT"] as const;
export type TaskDirectionFilter = (typeof TASK_DIRECTION_FILTERS)[number];

export const TASK_SORTS = [
  "DUE_DATE",
  "NEWEST",
  "OLDEST",
  "PRIORITY",
] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

/** Map API priority vocabulary → Prisma Priority enum. */
export function toPrismaTaskPriority(
  api: "LOW" | "NORMAL" | "HIGH" | "URGENT"
): "LOW" | "MEDIUM" | "HIGH" | "URGENT" {
  return api === "NORMAL" ? "MEDIUM" : api;
}

/**
 * Bidding-related + source EmailMessage.jobId null (or missing source email).
 * Used as NOT clause on the default operational Tasks list.
 * Calendar uses the broader calendarIneligibleBiddingTaskWhere.
 */
export function operationalUnassignedBiddingTaskWhere(): Prisma.TaskWhereInput {
  return {
    AND: [
      biddingRelatedTaskProvenanceWhere(),
      {
        OR: [
          { sourceMessage: { jobId: null } },
          { sourceMessageId: null },
        ],
      },
    ],
  };
}

export function taskStatusBucketWhere(
  status: TaskStatusFilter | undefined
): Prisma.TaskWhereInput | null {
  if (!status || status === "ALL") return null;
  if (status === "OPEN") {
    return { status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } };
  }
  if (status === "COMPLETED") {
    return { status: "DONE" };
  }
  return null;
}

export function taskPriorityWhere(
  priority: TaskPriorityFilter | undefined
): Prisma.TaskWhereInput | null {
  if (!priority || priority === "ALL") return null;
  return { priority: toPrismaTaskPriority(priority) };
}

export function taskSourceWhere(
  source: TaskSourceFilter | undefined
): Prisma.TaskWhereInput | null {
  if (!source || source === "ALL") return null;
  if (source === "EMAIL") return { sourceMessageId: { not: null } };
  return { sourceMessageId: null };
}

export function taskJobWhere(
  jobId: string | "NONE" | undefined
): Prisma.TaskWhereInput | null {
  if (!jobId) return null;
  if (jobId === "NONE") return { jobId: null };
  return { jobId };
}

export function taskEmailClassificationWhere(
  classification: TaskEmailClassificationFilter | undefined
): Prisma.TaskWhereInput | null {
  if (!classification || classification === "ALL") return null;
  if (classification === "UNCLASSIFIED") {
    return {
      OR: [
        { sourceMessageId: null },
        {
          sourceMessage: {
            mailboxCategory: { notIn: ["BUSINESS", "PERSONAL"] },
          },
        },
      ],
    };
  }
  return {
    sourceMessage: {
      mailboxCategory: classification,
    },
  };
}

export function taskBusinessSubtypeWhere(
  businessTypeKey: string | undefined
): Prisma.TaskWhereInput | null {
  if (!businessTypeKey?.trim()) return null;
  const key = businessTypeKey.trim();
  return {
    OR: [
      { classification: { businessTypeKey: key } },
      {
        sourceMessage: {
          classifications: { some: { businessTypeKey: key } },
        },
      },
    ],
  };
}

export function taskSenderSearchWhere(
  sender: string | undefined
): Prisma.TaskWhereInput | null {
  const q = sender?.trim();
  if (!q) return null;
  return {
    sourceMessage: {
      OR: [
        { senderEmail: { contains: q, mode: "insensitive" } },
        { senderName: { contains: q, mode: "insensitive" } },
      ],
    },
  };
}

/**
 * Direction relative to the monitored mailbox email (connection).
 * SENT = sourceMessage.senderEmail matches connection email.
 */
export function taskDirectionWhere(
  direction: TaskDirectionFilter | undefined,
  connectionEmail: string | undefined
): Prisma.TaskWhereInput | null {
  if (!direction || direction === "ALL") return null;
  const email = connectionEmail?.trim().toLowerCase();
  if (!email) return null;
  if (direction === "SENT") {
    return {
      sourceMessage: {
        senderEmail: { equals: email, mode: "insensitive" },
      },
    };
  }
  // INCOMING / Tasks: not outbound from the monitored mailbox (includes manual tasks).
  return {
    NOT: {
      sourceMessage: {
        senderEmail: { equals: email, mode: "insensitive" },
      },
    },
  };
}

/** Local-calendar day bounds for dueAt filters (inclusive start, exclusive end of window). */
export function dueAtRangeBounds(
  range: Exclude<TaskDueFilter, "ALL" | "NONE" | "OVERDUE">,
  timezone: string,
  now = new Date()
): { gte: Date; lt: Date } {
  const tz = timezone || "UTC";
  const today = zonedYmd(now, tz);
  if (range === "TODAY") {
    return {
      gte: zonedStartOfDay(today, tz),
      lt: zonedStartOfDay(addDaysYmd(today, 1), tz),
    };
  }
  if (range === "WEEK") {
    const weekStart = startOfWeekSundayYmd(today, tz);
    return {
      gte: zonedStartOfDay(weekStart, tz),
      lt: zonedStartOfDay(addDaysYmd(weekStart, 7), tz),
    };
  }
  // MONTH — calendar month containing today
  const monthStart = startOfMonthYmd(today);
  const y = Number(monthStart.slice(0, 4));
  const m = Number(monthStart.slice(5, 7));
  const nextMonthYmd =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return {
    gte: zonedStartOfDay(monthStart, tz),
    lt: zonedStartOfDay(nextMonthYmd, tz),
  };
}

export function taskDueWhere(
  due: TaskDueFilter | undefined,
  timezone: string,
  now = new Date()
): Prisma.TaskWhereInput | null {
  if (!due || due === "ALL") return null;
  if (due === "NONE") return { dueAt: null };
  if (due === "OVERDUE") {
    return {
      AND: [
        { dueAt: { lt: now } },
        { status: { notIn: ["DONE", "CANCELLED"] } },
      ],
    };
  }
  try {
    const bounds = dueAtRangeBounds(due, timezone || "UTC", now);
    return {
      dueAt: {
        gte: bounds.gte,
        lt: bounds.lt,
      },
    };
  } catch {
    return null;
  }
}

export function taskListOrderBy(
  sort: TaskSort | undefined
): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case "NEWEST":
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "OLDEST":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "PRIORITY":
      // Enum order is not semantic; still useful as a stable secondary grouping.
      return [
        { priority: "desc" },
        { dueAt: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ];
    case "DUE_DATE":
    default:
      // Overdue (past) → due soon → future → undated; then priority, stable id.
      return [
        { dueAt: { sort: "asc", nulls: "last" } },
        { priority: "desc" },
        { id: "asc" },
      ];
  }
}

export type BuildOperationalTasksWhereInput = {
  workspaceId: string;
  /** When set, scope to tasks whose source thread belongs to this connection. */
  inboxConnectionId?: string;
  /** When set, scope to Task.jobId (Job Tasks tab). */
  jobId?: string;
  /** Exclude unassigned bidding-related tasks (default operational view). */
  excludeUnassignedBidding?: boolean;
  status?: TaskStatusFilter;
  due?: TaskDueFilter;
  priority?: TaskPriorityFilter;
  source?: TaskSourceFilter;
  emailClassification?: TaskEmailClassificationFilter;
  businessTypeKey?: string;
  sender?: string;
  direction?: TaskDirectionFilter;
  connectionEmail?: string;
  /** Job filter for global Tasks: id | "NONE". Ignored when jobId scope is set. */
  jobFilter?: string | "NONE";
  timezone?: string;
  now?: Date;
  /** Only pinned tasks. */
  pinnedOnly?: boolean;
};

/**
 * Compose Prisma where for operational Task lists (connection- or job-scoped).
 */
export function buildOperationalTasksWhere(
  input: BuildOperationalTasksWhereInput
): Prisma.TaskWhereInput {
  const andConditions: Prisma.TaskWhereInput[] = [
    { workspaceId: input.workspaceId },
  ];

  if (input.inboxConnectionId) {
    andConditions.push({
      sourceThread: { inboxConnectionId: input.inboxConnectionId },
    });
  }

  if (input.jobId) {
    andConditions.push({ jobId: input.jobId });
  } else {
    const jobClause = taskJobWhere(input.jobFilter);
    if (jobClause) andConditions.push(jobClause);
  }

  if (input.excludeUnassignedBidding !== false) {
    andConditions.push({ NOT: operationalUnassignedBiddingTaskWhere() });
  }

  const push = (clause: Prisma.TaskWhereInput | null) => {
    if (clause) andConditions.push(clause);
  };

  push(taskStatusBucketWhere(input.status));
  push(taskDueWhere(input.due, input.timezone || "UTC", input.now));
  push(taskPriorityWhere(input.priority));
  push(taskSourceWhere(input.source));
  push(taskEmailClassificationWhere(input.emailClassification));
  push(taskBusinessSubtypeWhere(input.businessTypeKey));
  push(taskSenderSearchWhere(input.sender));
  push(taskDirectionWhere(input.direction, input.connectionEmail));

  if (input.pinnedOnly) {
    andConditions.push({ isPinned: true });
  }

  return { AND: andConditions };
}
