import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * NON_JOB_ONLY keeps Job emails. ALL_EMAILS removes every mailbox email.
 * HISTORICAL_IMPORT_ONLY removes Import Previous Emails and regular inbox
 * sync. Project-folder analysis stays.
 */
export type ClearInboxMode = "NON_JOB_ONLY" | "ALL_EMAILS" | "HISTORICAL_IMPORT_ONLY";

/**
 * Clear Inbox is a mailbox-wide bulk delete. Prisma's default interactive
 * timeout (5000ms) is too short for production mailboxes. 60s matches other
 * ForgeOps bulk txs (document import, mailbox import) without changing the
 * global Prisma timeout.
 */
export const CLEAR_INBOX_TRANSACTION_TIMEOUT_MS = 60_000;

export function clearInboxMessageWhere(input: {
  workspaceId: string;
  inboxConnectionId: string;
  mode: ClearInboxMode;
}): Prisma.EmailMessageWhereInput {
  return {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    ...(input.mode === "NON_JOB_ONLY" ? { jobId: null } : {}),
    ...(input.mode === "HISTORICAL_IMPORT_ONLY" ? { fromProjectFolder: false } : {}),
  };
}

/**
 * Delete EmailMessage rows matching `where`, plus email-owned children.
 * Threads are removed only when they have no messages left.
 * Does not delete Jobs, Customers, or DiscoveredFolder rows.
 * Does not call the mail provider — Clear Inbox / Clear All Emails must NEVER
 * honor `deleteFromProviderOnDelete` (that setting is Inbox UI trash only).
 *
 * Classification and Task FKs are SetNull on EmailMessage delete, so they are
 * deleted explicitly (Clear Inbox must not leave orphaned rows).
 * EmailAttachment, NormalizedEmail, BidCandidateEmail, BidQuoteStaging, and
 * BidFolderDiscoveryEmail cascade from EmailMessage — do not pre-delete them
 * (avoids extra nested mailbox scans inside the interactive transaction).
 */
export async function deleteScopedEmailMessages(
  tx: Prisma.TransactionClient,
  input: {
    where: Prisma.EmailMessageWhereInput;
    emptyThreadWhere: Prisma.EmailThreadWhereInput;
  }
): Promise<number> {
  await tx.task.deleteMany({
    where: { sourceMessage: input.where },
  });
  await tx.classification.deleteMany({
    where: { message: input.where },
  });
  const deleted = await tx.emailMessage.deleteMany({ where: input.where });
  await tx.emailThread.deleteMany({ where: input.emptyThreadWhere });
  return deleted.count;
}

export async function previewClearInbox(
  prisma: PrismaClient,
  input: { workspaceId: string; inboxConnectionId: string }
): Promise<{
  unassignedCount: number;
  jobAssociatedCount: number;
  nonProjectFolderCount: number;
  projectFolderCount: number;
  bidCandidateCount: number;
}> {
  const base = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
  };
  const [
    unassignedCount,
    jobAssociatedCount,
    nonProjectFolderCount,
    projectFolderCount,
    bidCandidateCount,
  ] = await Promise.all([
    prisma.emailMessage.count({ where: { ...base, jobId: null } }),
    prisma.emailMessage.count({ where: { ...base, jobId: { not: null } } }),
    prisma.emailMessage.count({ where: { ...base, fromProjectFolder: false } }),
    prisma.emailMessage.count({ where: { ...base, fromProjectFolder: true } }),
    prisma.bidCandidate.count({ where: { workspaceId: input.workspaceId } }),
  ]);
  return {
    unassignedCount,
    jobAssociatedCount,
    nonProjectFolderCount,
    projectFolderCount,
    bidCandidateCount,
  };
}

/**
 * Delete every BidCandidate in the workspace.
 * Quote staging linked to those Candidates is removed; Jobs/Customers are not.
 * BidCandidateEmail cascades from Candidate delete.
 * canonicalJobId is SetNull on Job side — Jobs survive.
 */
export async function deleteWorkspaceBidCandidates(
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<{ bidCandidatesDeleted: number; quoteStagingsUnlinked: number }> {
  const candidates = await tx.bidCandidate.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  if (candidates.length === 0) {
    return { bidCandidatesDeleted: 0, quoteStagingsUnlinked: 0 };
  }
  const candidateIds = candidates.map((c) => c.id);

  // Remove Candidate-specific Quote staging before Candidate delete.
  // (Schema would SetNull bidCandidateId; explicit delete avoids orphan durable rows.)
  const quotes = await tx.bidQuoteStaging.deleteMany({
    where: {
      workspaceId,
      bidCandidateId: { in: candidateIds },
    },
  });

  // BidCandidateEmail cascades via BidCandidate.onDelete=Cascade.
  const deleted = await tx.bidCandidate.deleteMany({
    where: { workspaceId, id: { in: candidateIds } },
  });

  return {
    bidCandidatesDeleted: deleted.count,
    quoteStagingsUnlinked: quotes.count,
  };
}

export async function clearConnectionInbox(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    inboxConnectionId: string;
    mode: ClearInboxMode;
    clearedAt: Date;
    /**
     * When true, permanently delete ALL BidCandidates in the workspace
     * (including quoted / converted Candidate rows). Jobs are preserved.
     * Default false — omitted/false preserves Candidates.
     */
    includeBidCandidates?: boolean;
  }
): Promise<{
  deletedCount: number;
  preservedJobEmailCount: number;
  removedJobEmailCount: number;
  bidCandidatesDeleted: number;
  quoteStagingsRemovedWithCandidates: number;
}> {
  const messageWhere = clearInboxMessageWhere(input);
  // Only Clear All Emails may opt into Candidate deletion. Other modes ignore the flag.
  const includeBidCandidates =
    input.mode === "ALL_EMAILS" && input.includeBidCandidates === true;
  return prisma.$transaction(
    async (tx) => {
      let bidCandidatesDeleted = 0;
      let quoteStagingsRemovedWithCandidates = 0;
      if (includeBidCandidates) {
        const cand = await deleteWorkspaceBidCandidates(tx, input.workspaceId);
        bidCandidatesDeleted = cand.bidCandidatesDeleted;
        quoteStagingsRemovedWithCandidates = cand.quoteStagingsUnlinked;
      }

      const jobAssociatedCount = await tx.emailMessage.count({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          jobId: { not: null },
        },
      });
      const deletedCount = await deleteScopedEmailMessages(tx, {
        where: messageWhere,
        emptyThreadWhere: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          messages: { none: {} },
        },
      });
      // Every mode deletes live inbox mail, so the watermark has to move or
      // the next sync brings those messages back. Project-folder analysis
      // bypasses the watermark and is kept by HISTORICAL_IMPORT_ONLY.
      await tx.inboxConnection.update({
        where: { id: input.inboxConnectionId },
        data: {
          inboxClearedAt: input.clearedAt,
          syncCursor: null,
        },
      });
      return {
        deletedCount,
        preservedJobEmailCount: input.mode === "NON_JOB_ONLY" ? jobAssociatedCount : 0,
        removedJobEmailCount: input.mode === "ALL_EMAILS" ? jobAssociatedCount : 0,
        bidCandidatesDeleted,
        quoteStagingsRemovedWithCandidates,
      };
    },
    { timeout: CLEAR_INBOX_TRANSACTION_TIMEOUT_MS }
  );
}
