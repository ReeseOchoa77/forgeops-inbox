/**
 * Conflict-aware EmailMessage → Job association for explicit Bid Import.
 * Human-confirmed import uses USER_ASSIGNED; never silently steals protected assignments.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isProtectedJobAssignment,
  learnJobContactsFromEmails,
} from "@forgeops/shared";
import { USER_BID_ASSIGNMENT } from "./bidding.js";

export type BidImportEmailConflict = {
  emailMessageId: string;
  existingJobId: string;
  jobAssignmentSource: string | null;
  reason: string;
};

export type AssociateBidImportEmailsResult = {
  attachedEmailIds: string[];
  skippedUnchanged: string[];
  conflicts: BidImportEmailConflict[];
};

/**
 * Only accepted Quote relationships become Job evidence on Import.
 * MATCHED = strong auto-link or user-confirmed reassignment.
 * NEEDS_REVIEW / POSSIBLE_MATCH / UNMATCHED never attach automatically.
 */
const IMPORTABLE_QUOTE_STATUSES = ["MATCHED"] as const;

/**
 * Collect canonical EmailMessage ids for a candidate:
 * - BidCandidateEmail links that are invite/addendum/supporting, OR quote links
 *   only when the corresponding BidQuoteStaging is MATCHED
 * - plus MATCHED BidQuoteStaging source emails (no duplicates)
 */
export async function collectBidCandidateImportEmailIds(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    workspaceId: string;
    candidateId: string;
    /**
     * Convert to Job: include every durable BidCandidateEmail link
     * (BID_INVITE / QUOTE / SUPPORTING / ADDENDUM). Quote staging MATCHED
     * emails are still merged. Staging Import historically gated QUOTE links
     * on MATCHED only — pass false/omit for that stricter behavior.
     */
    includeAllCandidateEmailLinks?: boolean;
  }
): Promise<string[]> {
  const [links, quotes] = await Promise.all([
    prisma.bidCandidateEmail.findMany({
      where: {
        workspaceId: input.workspaceId,
        bidCandidateId: input.candidateId,
      },
      select: { emailMessageId: true, role: true },
    }),
    prisma.bidQuoteStaging.findMany({
      where: {
        workspaceId: input.workspaceId,
        bidCandidateId: input.candidateId,
        matchStatus: { in: [...IMPORTABLE_QUOTE_STATUSES] },
        rejectedAt: null,
      },
      select: { emailMessageId: true },
    }),
  ]);

  const matchedQuoteEmailIds = new Set(quotes.map((q) => q.emailMessageId));
  const ids = new Set<string>();
  for (const l of links) {
    if (
      l.role === "QUOTE" &&
      !input.includeAllCandidateEmailLinks &&
      !matchedQuoteEmailIds.has(l.emailMessageId)
    ) {
      // Ambiguous quote links must not become Job evidence on staging Import.
      continue;
    }
    ids.add(l.emailMessageId);
  }
  for (const q of quotes) ids.add(q.emailMessageId);
  return [...ids];
}

/**
 * Associate staging source emails to a Job with conflict checks.
 * Idempotent: same jobId already set → unchanged skip.
 * Protected assignment to a different Job → conflict (not overwritten).
 */
export async function associateBidImportEmails(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  jobId: string;
  userId: string;
  emailMessageIds: string[];
  now?: Date;
}): Promise<AssociateBidImportEmailsResult> {
  const now = input.now ?? new Date();
  const uniqueIds = [...new Set(input.emailMessageIds.filter(Boolean))];
  const result: AssociateBidImportEmailsResult = {
    attachedEmailIds: [],
    skippedUnchanged: [],
    conflicts: [],
  };
  if (uniqueIds.length === 0) return result;

  const messages = await input.prisma.emailMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      id: { in: uniqueIds },
    },
    select: {
      id: true,
      jobId: true,
      jobAssignmentIsManual: true,
      jobAssignmentSource: true,
    },
  });

  const assignable: string[] = [];
  for (const msg of messages) {
    if (msg.jobId === input.jobId) {
      result.skippedUnchanged.push(msg.id);
      continue;
    }
    if (
      msg.jobId &&
      msg.jobId !== input.jobId &&
      isProtectedJobAssignment({
        jobAssignmentIsManual: msg.jobAssignmentIsManual,
        jobAssignmentSource: msg.jobAssignmentSource,
      })
    ) {
      result.conflicts.push({
        emailMessageId: msg.id,
        existingJobId: msg.jobId,
        jobAssignmentSource: msg.jobAssignmentSource,
        reason:
          "Email is already assigned to another Job with a protected assignment (USER_ASSIGNED or VERIFIED_PROJECT_FOLDER)",
      });
      continue;
    }
    assignable.push(msg.id);
  }

  if (assignable.length > 0) {
    await input.prisma.emailMessage.updateMany({
      where: {
        workspaceId: input.workspaceId,
        id: { in: assignable },
      },
      data: {
        jobId: input.jobId,
        ...USER_BID_ASSIGNMENT,
        jobAssignedAt: now,
        jobAssignedByUserId: input.userId,
      },
    });
    result.attachedEmailIds = assignable;
    await learnJobContactsFromEmails(input.prisma, {
      workspaceId: input.workspaceId,
      emailMessageIds: assignable,
      now,
    });
  }

  return result;
}
