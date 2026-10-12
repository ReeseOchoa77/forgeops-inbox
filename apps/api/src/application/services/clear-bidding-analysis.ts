/**
 * Clear Bidding Folder Analysis staging/discovery for one mailbox.
 * Never deletes EmailMessage, Jobs, Customers, Outlook mail, or Project Folder state.
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
};

/**
 * Returns Bidding Folder Analysis to a clean pre-scan state for the mailbox.
 * CONFIRMED (imported) candidates are kept as import history.
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

    const quotesDeleted = (
      await tx.bidQuoteStaging.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.connectionId,
        },
      })
    ).count;

    // Unlink only non-imported staging candidates (keep CONFIRMED import history links).
    let candidateEmailsUnlinked = 0;
    if (discoveryEmailIds.length > 0) {
      const openLinks = await tx.bidCandidateEmail.findMany({
        where: {
          workspaceId: input.workspaceId,
          emailMessageId: { in: discoveryEmailIds },
          bidCandidate: { status: { not: "CONFIRMED" } },
        },
        select: { id: true },
      });
      if (openLinks.length > 0) {
        candidateEmailsUnlinked = (
          await tx.bidCandidateEmail.deleteMany({
            where: { id: { in: openLinks.map((l) => l.id) } },
          })
        ).count;
      }
    }

    // Staging candidates with no remaining email links (and not imported).
    const emptyOpen = await tx.bidCandidate.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: { not: "CONFIRMED" },
        emails: { none: {} },
      },
      select: { id: true },
    });
    if (emptyOpen.length > 0) {
      await tx.bidCandidate.deleteMany({
        where: { id: { in: emptyOpen.map((c) => c.id) } },
      });
    }

    // Also remove non-confirmed candidates that only ever pointed at this mailbox's
    // discovery set (already unlinked above → caught by emptyOpen). Manual candidates
    // with zero emails are included. Remaining open candidates with other emails stay.

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
      candidatesDeleted: emptyOpen.length,
      runsDeleted,
    };
  });
}
