/**
 * Clear Bidding Folder Analysis staging/discovery for one mailbox.
 * Never deletes EmailMessage, EmailAttachment, Jobs, Customers, Outlook mail,
 * or Project Folder state. Keeps CONFIRMED (imported) BidCandidate history.
 */

import type { PrismaClient } from "@prisma/client";
import {
  bidCandidateBelongsToMailboxWhere,
  clearableBidCandidatesForMailboxWhere,
} from "./bid-candidate-mailbox-scope.js";

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
 * Deletes: discovery index, quote staging, non-CONFIRMED candidates belonging
 * to this mailbox (same ownership predicate as GET candidates), runs.
 *
 * Ownership includes BidCandidateEmail → EmailMessage.inboxConnectionId so
 * legacy bid-first / remnant staging rows clear even when discovery/quotes
 * were already removed.
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

  const mailbox = {
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
  };

  return input.prisma.$transaction(async (tx) => {
    const openCandidates = await tx.bidCandidate.findMany({
      where: clearableBidCandidatesForMailboxWhere(mailbox),
      select: { id: true },
    });
    const openCandidateIds = openCandidates.map((c) => c.id);

    const confirmedRetained = await tx.bidCandidate.count({
      where: {
        AND: [
          bidCandidateBelongsToMailboxWhere(mailbox),
          { status: "CONFIRMED" },
        ],
      },
    });

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
