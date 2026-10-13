/**
 * Clear Bidding Folder Analysis staging/discovery for one mailbox.
 * Never deletes EmailMessage, EmailAttachment, Jobs, Customers, Outlook mail,
 * or Project Folder state. Keeps CONFIRMED (imported) BidCandidate history.
 */

import type { PrismaClient } from "@prisma/client";

export class ClearBiddingAnalysisError extends Error {
  readonly code: "FORBIDDEN" | "CONNECTION_REQUIRED";

  constructor(code: ClearBiddingAnalysisError["code"], message: string) {
    super(message);
    this.name = "ClearBiddingAnalysisError";
    this.code = code;
  }
}

export type ClearBiddingAnalysisResult = {
  discoveryDeleted: number;
  quotesDeleted: number;
  candidateEmailsUnlinked: number;
  candidatesDeleted: number;
  runsDeleted: number;
  /** CONFIRMED candidates retained as import history (not deleted). */
  confirmedRetained: number;
};

/**
 * Returns active Bidding Folder Analysis to a clean pre-scan state for the mailbox.
 *
 * Deletes: discovery index, quote staging, non-CONFIRMED candidates associated
 * with this mailbox (including Inbox-fallback BidCandidateEmail links), runs.
 *
 * Retains: EmailMessage, attachments/PDF text cache, Jobs, Customers,
 * CONFIRMED BidCandidates (+ their BidCandidateEmail links).
 */
export async function clearBiddingAnalysisStaging(input: {
  prisma: PrismaClient;
  workspaceId: string;
  connectionId: string;
}): Promise<ClearBiddingAnalysisResult> {
  if (!input.connectionId.trim()) {
    throw new ClearBiddingAnalysisError(
      "CONNECTION_REQUIRED",
      "Mailbox connectionId is required"
    );
  }

  return input.prisma.$transaction(async (tx) => {
    const discovery = await tx.bidFolderDiscoveryEmail.findMany({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.connectionId,
      },
      select: { emailMessageId: true },
    });
    const discoveryEmailIds = discovery.map((d) => d.emailMessageId);

    // Quote staging ties candidates to this mailbox even when Inbox-fallback
    // Bid emails are not in BidFolderDiscoveryEmail.
    const quoteRows = await tx.bidQuoteStaging.findMany({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.connectionId,
      },
      select: { bidCandidateId: true, emailMessageId: true },
    });
    const quoteCandidateIds = quoteRows
      .map((q) => q.bidCandidateId)
      .filter((id): id is string => Boolean(id));
    const quoteEmailIds = quoteRows.map((q) => q.emailMessageId);

    const associatedEmailIds = [
      ...new Set([...discoveryEmailIds, ...quoteEmailIds]),
    ];

    const linkedOpen = associatedEmailIds.length
      ? await tx.bidCandidateEmail.findMany({
          where: {
            workspaceId: input.workspaceId,
            emailMessageId: { in: associatedEmailIds },
            bidCandidate: { status: { not: "CONFIRMED" } },
          },
          select: { bidCandidateId: true },
        })
      : [];

    const candidateIdSet = new Set<string>([
      ...quoteCandidateIds,
      ...linkedOpen.map((l) => l.bidCandidateId),
    ]);

    // Manual / orphan open candidates with zero emails are mailbox-ambiguous
    // (BidCandidate has no inboxConnectionId). Only clear those with no emails
    // that were never confirmed — scoped by also requiring they appear in
    // quoteCandidateIds or linkedOpen. Pure empty manual candidates outside
    // this mailbox are left alone for isolation.

    const openCandidateIds = candidateIdSet.size
      ? (
          await tx.bidCandidate.findMany({
            where: {
              workspaceId: input.workspaceId,
              id: { in: [...candidateIdSet] },
              status: { not: "CONFIRMED" },
            },
            select: { id: true },
          })
        ).map((c) => c.id)
      : [];

    const confirmedRetained = candidateIdSet.size
      ? await tx.bidCandidate.count({
          where: {
            workspaceId: input.workspaceId,
            id: { in: [...candidateIdSet] },
            status: "CONFIRMED",
          },
        })
      : 0;

    // Quotes first (FK to BidCandidate is SetNull on delete of candidate,
    // but we remove staging rows regardless of match status).
    const quotesDeleted = (
      await tx.bidQuoteStaging.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.connectionId,
        },
      })
    ).count;

    let candidateEmailsUnlinked = 0;
    if (openCandidateIds.length > 0) {
      // Remove ALL links on open candidates for this mailbox analysis —
      // including Inbox-fallback Bid emails not present in discovery.
      candidateEmailsUnlinked = (
        await tx.bidCandidateEmail.deleteMany({
          where: {
            workspaceId: input.workspaceId,
            bidCandidateId: { in: openCandidateIds },
          },
        })
      ).count;

      await tx.bidCandidate.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          id: { in: openCandidateIds },
          status: { not: "CONFIRMED" },
        },
      });
    }

    const discoveryDeleted = (
      await tx.bidFolderDiscoveryEmail.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.connectionId,
        },
      })
    ).count;

    const runsDeleted = (
      await tx.bidAnalysisRun.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.connectionId,
        },
      })
    ).count;

    return {
      discoveryDeleted,
      quotesDeleted,
      candidateEmailsUnlinked,
      candidatesDeleted: openCandidateIds.length,
      runsDeleted,
      confirmedRetained,
    };
  });
}
