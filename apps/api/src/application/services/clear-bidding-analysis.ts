/**
 * Clear Bidding Folder Analysis reconstructable artifacts for one mailbox.
 *
 * Never deletes:
 * - BidCandidate (permanent operational opportunities)
 * - BidCandidateEmail (durable Candidate ↔ email links)
 * - durable BidQuoteStaging (isDurable / linked / user-confirmed)
 * - EmailMessage, EmailAttachment, Jobs, Customers
 * - user edits on Candidates
 *
 * Deletes only:
 * - BidFolderDiscoveryEmail (scan index)
 * - BidAnalysisRun
 * - ephemeral BidQuoteStaging (not durable, not linked to a Candidate)
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
  /** Ephemeral unmatched quote staging only. */
  quotesDeleted: number;
  /** Always 0 — Candidate email links are durable. */
  candidateEmailsUnlinked: number;
  /** Always 0 — Candidates are permanent. */
  candidatesDeleted: number;
  runsDeleted: number;
  /** Count of permanent Candidates in mailbox provenance (informational). */
  candidatesRetained: number;
  /** Durable quotes retained (informational). */
  durableQuotesRetained: number;
};

/**
 * Returns analysis scan state to a clean pre-scan index for the mailbox
 * without destroying permanent Bid Candidate business data.
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
    const candidatesRetained = await tx.bidCandidate.count({
      where: { workspaceId: input.workspaceId },
    });

    const durableQuotesRetained = await tx.bidQuoteStaging.count({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.connectionId,
        OR: [
          { isDurable: true },
          { bidCandidateId: { not: null } },
          { userConfirmedMatch: true },
        ],
      },
    });

    // Ephemeral quote extracts only — never durable Candidate evidence.
    const quotesDeleted = (
      await tx.bidQuoteStaging.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.connectionId,
          isDurable: false,
          bidCandidateId: null,
          userConfirmedMatch: false,
        },
      })
    ).count;

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
      candidateEmailsUnlinked: 0,
      candidatesDeleted: 0,
      runsDeleted,
      candidatesRetained,
      durableQuotesRetained,
    };
  });
}
