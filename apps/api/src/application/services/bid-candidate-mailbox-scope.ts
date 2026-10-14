/**
 * Shared mailbox ownership for Bidding Analysis Candidates.
 * Clear All and GET must use the same predicate so staging cannot "return" after reload.
 */

import type { Prisma } from "@prisma/client";

/**
 * BidCandidate belongs to mailbox `connectionId` when ANY of:
 * - BidQuoteStaging.inboxConnectionId matches
 * - BidCandidateEmail → EmailMessage.inboxConnectionId matches
 *   (covers Bid Invites, Quotes, Inbox-fallback, and legacy bid-first shapes
 *   even when BidFolderDiscoveryEmail rows are already gone)
 * - BidCandidateEmail → EmailMessage appears in BidFolderDiscoveryEmail for that mailbox
 */
export function bidCandidateBelongsToMailboxWhere(input: {
  workspaceId: string;
  connectionId: string;
}): Prisma.BidCandidateWhereInput {
  const { workspaceId, connectionId } = input;
  return {
    workspaceId,
    OR: [
      {
        quoteStagings: {
          some: { workspaceId, inboxConnectionId: connectionId },
        },
      },
      {
        emails: {
          some: {
            workspaceId,
            emailMessage: { inboxConnectionId: connectionId },
          },
        },
      },
      {
        emails: {
          some: {
            workspaceId,
            emailMessage: {
              bidFolderDiscoveries: {
                some: { workspaceId, inboxConnectionId: connectionId },
              },
            },
          },
        },
      },
    ],
  };
}

/** Active review dataset — excludes imported history and rejected staging. */
export function activeBidCandidatesForMailboxWhere(input: {
  workspaceId: string;
  connectionId: string;
}): Prisma.BidCandidateWhereInput {
  return {
    AND: [
      bidCandidateBelongsToMailboxWhere(input),
      { status: { notIn: ["CONFIRMED", "REJECTED"] } },
    ],
  };
}

/**
 * @deprecated Clear Analysis no longer deletes BidCandidates.
 * Retained for tests / callers that only need the historical predicate shape.
 */
export function clearableBidCandidatesForMailboxWhere(input: {
  workspaceId: string;
  connectionId: string;
}): Prisma.BidCandidateWhereInput {
  return {
    AND: [
      bidCandidateBelongsToMailboxWhere(input),
      { status: { not: "CONFIRMED" } },
    ],
  };
}
