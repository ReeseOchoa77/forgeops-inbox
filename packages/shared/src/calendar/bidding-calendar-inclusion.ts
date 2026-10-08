/**
 * Calendar inclusion rules for bidding (V1).
 *
 * Active bid deadline (canonical):
 *   Job.status === "BIDDING" && Job.bidDueAt != null && archivedAt == null
 *   → synthesize "Bid Due — {Job.name}"
 *
 * Email-derived bidding Tasks (BID_OPPORTUNITY / BID_UPDATE):
 *   source EmailMessage.jobId == null  → NOT on Calendar
 *   source EmailMessage.jobId set + Job already has Bid Due → NOT on Calendar
 *     (canonical Job.bidDueAt wins; avoid duplicate deadline items)
 *
 * Bidding-related is structural (Classification.businessTypeKey), never title text.
 * Source EmailMessage.jobId is authoritative for assignment (not Task.jobId).
 *
 * Do not require classifier sourceTaskKey — n8n keys are opaque SHA hex and would
 * otherwise leak past a native:/heuristic-only filter.
 */

import type { Prisma } from "@prisma/client";
import { classifierGeneratedTaskKeyFilter } from "../classifier-generated-tasks.js";

/** Subtypes that mean "bidding-related email", not necessarily an active BIDDING Job. */
export const RAW_BIDDING_OPPORTUNITY_BUSINESS_TYPES = [
  "BID_OPPORTUNITY",
  "BID_UPDATE",
] as const;

export type RawBiddingOpportunityBusinessType =
  (typeof RAW_BIDDING_OPPORTUNITY_BUSINESS_TYPES)[number];

export function isRawBiddingOpportunityBusinessType(
  key: string | null | undefined
): key is RawBiddingOpportunityBusinessType {
  return key === "BID_OPPORTUNITY" || key === "BID_UPDATE";
}

/** Prisma fragment: Task provenance is bidding-related (BID_*). */
export function biddingRelatedTaskProvenanceWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      {
        classification: {
          businessTypeKey: {
            in: [...RAW_BIDDING_OPPORTUNITY_BUSINESS_TYPES],
          },
        },
      },
      {
        sourceMessage: {
          classifications: {
            some: {
              businessTypeKey: {
                in: [...RAW_BIDDING_OPPORTUNITY_BUSINESS_TYPES],
              },
            },
          },
        },
      },
    ],
  };
}

/**
 * Calendar NOT clause: bidding-related Tasks that must not appear as taskDueItems.
 *
 * Unassigned source email OR source Job already exposes canonical Bid Due.
 * Single batched Prisma relation filter — no N+1.
 */
export function calendarIneligibleBiddingTaskWhere(): Prisma.TaskWhereInput {
  return {
    AND: [
      biddingRelatedTaskProvenanceWhere(),
      {
        OR: [
          // No explicit Job assignment on the CURRENT source email.
          { sourceMessage: { jobId: null } },
          // Duplicate of canonical Bid Due — Job.bidDueAt already feeds Calendar.
          {
            sourceMessage: {
              job: {
                status: "BIDDING",
                bidDueAt: { not: null },
                archivedAt: null,
              },
            },
          },
          // Bidding-related but missing source email — cannot verify assignment.
          { sourceMessageId: null },
        ],
      },
    ],
  };
}

/**
 * @deprecated Prefer `calendarIneligibleBiddingTaskWhere` for Calendar.
 * Kept for Tasks-list hiding of classifier-keyed BID_* rows only.
 */
export function classifierRawBiddingOpportunityTaskWhere(): Prisma.TaskWhereInput {
  return {
    AND: [
      classifierGeneratedTaskKeyFilter(),
      biddingRelatedTaskProvenanceWhere(),
    ],
  };
}

/** Jobs eligible for synthetic Bid Due Calendar items. */
export function activeBiddingJobBidDueWhere(
  workspaceId: string
): Prisma.JobWhereInput {
  return {
    workspaceId,
    status: "BIDDING",
    bidDueAt: { not: null },
    archivedAt: null,
  };
}

export function formatBidDueCalendarTitle(jobName: string): string {
  const name = jobName.trim() || "Untitled job";
  return `Bid Due — ${name}`;
}

/** Pure helper for Calendar DTO synthesis (unit-testable). */
export function shouldSynthesizeBidDueCalendarItem(job: {
  status: string;
  bidDueAt: Date | string | null | undefined;
  archivedAt?: Date | string | null;
}): boolean {
  if (job.status !== "BIDDING") return false;
  if (job.archivedAt != null) return false;
  return job.bidDueAt != null;
}

/**
 * Relational fixture shape for Calendar Task eligibility tests.
 * Mirrors Task → sourceMessage (+ classifications) / classification joins.
 */
export type CalendarTaskEligibilityInput = {
  /** Task.classification (optional direct FK). */
  classification?: { businessTypeKey: string | null } | null;
  /** Task.sourceMessage — CURRENT assignment is authoritative. */
  sourceMessage: {
    id: string;
    jobId: string | null;
    classifications: Array<{ businessTypeKey: string | null }>;
    job?: {
      id: string;
      status: string;
      bidDueAt: Date | string | null;
      archivedAt?: Date | string | null;
    } | null;
  } | null;
};

export function isBiddingRelatedTaskProvenance(
  input: CalendarTaskEligibilityInput
): boolean {
  if (isRawBiddingOpportunityBusinessType(input.classification?.businessTypeKey)) {
    return true;
  }
  return (input.sourceMessage?.classifications ?? []).some((c) =>
    isRawBiddingOpportunityBusinessType(c.businessTypeKey)
  );
}

/**
 * Central Calendar eligibility for Tasks (bidding rules only).
 * Non-bidding Tasks return true — other Calendar filters still apply at query time.
 */
export function isTaskEligibleForCalendar(
  input: CalendarTaskEligibilityInput
): boolean {
  if (!isBiddingRelatedTaskProvenance(input)) return true;

  const email = input.sourceMessage;
  if (!email || email.jobId == null) return false;

  // Canonical Bid Due already on Calendar for this Job — suppress duplicate Task.
  if (email.job && shouldSynthesizeBidDueCalendarItem(email.job)) {
    return false;
  }

  // Assigned to a Job without an active Bid Due item (e.g. ACTIVE/LEAD, or
  // BIDDING with null bidDueAt): Task may appear as a normal due item.
  return true;
}
