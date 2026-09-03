import type { Prisma } from "@prisma/client";
import { inboxDateRangeBounds } from "./date-bounds.js";

/**
 * Filters for mailbox-scoped admin reclassification preview/run.
 * Distinct from Inbox Unclassified tab: processingStatus NULL ≠ unclassifiedOnly.
 */

export const RECLASSIFY_CATEGORY_VALUES = [
  "ALL",
  "BUSINESS",
  "PERSONAL",
  "UNCLASSIFIED",
  "FAILED",
] as const;

export type ReclassifyCategoryFilter =
  (typeof RECLASSIFY_CATEGORY_VALUES)[number];

export const RECLASSIFY_DIRECTION_VALUES = [
  "ANY",
  "RECEIVED",
  "SENT",
] as const;

export type ReclassifyDirectionFilter =
  (typeof RECLASSIFY_DIRECTION_VALUES)[number];

export const RECLASSIFY_READ_VALUES = ["ANY", "READ", "UNREAD"] as const;
export type ReclassifyReadFilter = (typeof RECLASSIFY_READ_VALUES)[number];

export const RECLASSIFY_JOB_SCOPE_VALUES = [
  "ANY",
  "HAS_JOB",
  "NO_JOB",
  "SPECIFIC",
] as const;

export type ReclassifyJobScopeFilter =
  (typeof RECLASSIFY_JOB_SCOPE_VALUES)[number];

export const RECLASSIFY_PROCESSING_STATUS_VALUES = [
  "ANY",
  "NULL",
  "PENDING",
  "PROCESSING",
  "CLASSIFIED",
  "FAILED",
] as const;

export type ReclassifyProcessingStatusFilter =
  (typeof RECLASSIFY_PROCESSING_STATUS_VALUES)[number];

/** UI NORMAL maps to stored MEDIUM. */
export const RECLASSIFY_PRIORITY_VALUES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;

export type ReclassifyPriorityFilter =
  (typeof RECLASSIFY_PRIORITY_VALUES)[number];

export type MailboxReclassifyFilters = {
  category?: ReclassifyCategoryFilter;
  /** Classification.businessTypeKey multi-select (OR within). */
  businessTypeKeys?: string[];
  senderEmailEquals?: string;
  senderContains?: string;
  readStatus?: ReclassifyReadFilter;
  direction?: ReclassifyDirectionFilter;
  dateRange?: "TODAY" | "WEEK" | "MONTH";
  customStartYmd?: string;
  customEndYmd?: string;
  timezone?: string;
  priorities?: ReclassifyPriorityFilter[];
  jobScope?: ReclassifyJobScopeFilter;
  jobId?: string;
  processingStatus?: ReclassifyProcessingStatusFilter;
  hasAttachments?: boolean | null;
};

export const MAILBOX_RECLASSIFY_ENQUEUE_BATCH = 50;
export const MAILBOX_RECLASSIFY_PREVIEW_SAMPLE = 20;
export const MAILBOX_RECLASSIFY_MAX_SELECTED = 500;

function mapUiPriorityToStored(
  p: ReclassifyPriorityFilter
): "LOW" | "MEDIUM" | "HIGH" | "URGENT" {
  if (p === "NORMAL") return "MEDIUM";
  return p;
}

/**
 * Build Prisma where for reclassify candidate selection (mailbox-scoped).
 * Does not load bodies. Composes filters with AND; multi-selects OR within field.
 */
export function buildMailboxReclassifyWhere(input: {
  workspaceId: string;
  inboxConnectionId: string;
  mailboxEmail: string;
  filters: MailboxReclassifyFilters;
  /** When set, restrict to these ids (intersection with filters). */
  messageIds?: string[];
}): Prisma.EmailMessageWhereInput {
  const f = input.filters;
  const and: Prisma.EmailMessageWhereInput[] = [
    {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      isArchived: false,
    },
  ];

  if (input.messageIds && input.messageIds.length > 0) {
    and.push({ id: { in: input.messageIds } });
  }

  const category = f.category ?? "ALL";
  if (category === "UNCLASSIFIED") {
    and.push({ classifications: { none: {} } });
  } else if (category === "FAILED") {
    and.push({ classificationStatus: "FAILED" });
  } else if (category === "BUSINESS") {
    and.push({
      mailboxCategory: "BUSINESS",
      classifications: { some: {} },
    });
  } else if (category === "PERSONAL") {
    and.push({
      mailboxCategory: "PERSONAL",
      classifications: { some: {} },
    });
  }

  if (f.businessTypeKeys && f.businessTypeKeys.length > 0) {
    and.push({
      classifications: {
        some: { businessTypeKey: { in: f.businessTypeKeys } },
      },
    });
  }

  if (f.senderEmailEquals?.trim()) {
    and.push({
      senderEmail: {
        equals: f.senderEmailEquals.trim(),
        mode: "insensitive",
      },
    });
  } else if (f.senderContains?.trim()) {
    and.push({
      senderEmail: {
        contains: f.senderContains.trim(),
        mode: "insensitive",
      },
    });
  }

  if (f.readStatus === "READ") and.push({ isRead: true });
  if (f.readStatus === "UNREAD") and.push({ isRead: false });

  const mailboxEmail = input.mailboxEmail.trim().toLowerCase();
  if (f.direction === "SENT" && mailboxEmail) {
    and.push({
      senderEmail: { equals: mailboxEmail, mode: "insensitive" },
    });
  } else if (f.direction === "RECEIVED" && mailboxEmail) {
    and.push({
      senderEmail: {
        not: mailboxEmail,
        mode: "insensitive" as const,
      },
    });
  }

  const tz = f.timezone?.trim() || "UTC";
  if (f.dateRange === "TODAY" || f.dateRange === "WEEK" || f.dateRange === "MONTH") {
    const bounds = inboxDateRangeBounds(f.dateRange, tz);
    and.push({
      OR: [
        {
          receivedAt: {
            gte: bounds.receivedAfter,
            lte: bounds.receivedBefore,
          },
        },
        {
          AND: [
            { receivedAt: null },
            {
              sentAt: {
                gte: bounds.receivedAfter,
                lte: bounds.receivedBefore,
              },
            },
          ],
        },
      ],
    });
  } else if (f.customStartYmd || f.customEndYmd) {
    const range: Prisma.DateTimeFilter = {};
    if (f.customStartYmd) {
      range.gte = new Date(`${f.customStartYmd}T00:00:00.000Z`);
    }
    if (f.customEndYmd) {
      range.lte = new Date(`${f.customEndYmd}T23:59:59.999Z`);
    }
    and.push({
      OR: [
        { receivedAt: range },
        { AND: [{ receivedAt: null }, { sentAt: range }] },
      ],
    });
  }

  if (f.priorities && f.priorities.length > 0) {
    const stored = f.priorities.map(mapUiPriorityToStored);
    and.push({ priority: { in: stored } });
  }

  const jobScope = f.jobScope ?? "ANY";
  if (jobScope === "HAS_JOB") and.push({ jobId: { not: null } });
  if (jobScope === "NO_JOB") and.push({ jobId: null });
  if (jobScope === "SPECIFIC" && f.jobId?.trim()) {
    and.push({ jobId: f.jobId.trim() });
  }

  const proc = f.processingStatus ?? "ANY";
  if (proc === "NULL") and.push({ classificationStatus: null });
  else if (
    proc === "PENDING" ||
    proc === "PROCESSING" ||
    proc === "CLASSIFIED" ||
    proc === "FAILED"
  ) {
    and.push({ classificationStatus: proc });
  }

  if (f.hasAttachments === true) and.push({ hasAttachments: true });
  if (f.hasAttachments === false) and.push({ hasAttachments: false });

  return { AND: and };
}
