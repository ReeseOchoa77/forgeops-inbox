/**
 * Single source of truth for Inbox → Active Bid membership.
 *
 * Active Bids UI default list = BidCandidate.lifecycle OPEN | QUOTED
 * (see list-bid-candidates). Candidate Emails tab = BidCandidateEmail.
 * Inbox Active Bid must use both — not folder provenance, not BID_OPPORTUNITY subtype.
 */

import type { Prisma } from "@prisma/client";

export const ACTIVE_BID_LIST_LIFECYCLES = ["OPEN", "QUOTED"] as const;

export type ActiveBidListLifecycle = (typeof ACTIVE_BID_LIST_LIFECYCLES)[number];

export function activeBidListLifecycleWhere(): Prisma.BidCandidateWhereInput {
  return { lifecycle: { in: [...ACTIVE_BID_LIST_LIFECYCLES] } };
}

/**
 * EmailMessage belongs to at least one Active Bids-list BidCandidate
 * via the durable BidCandidateEmail link (Emails tab).
 * Prisma `some` does not duplicate EmailMessage rows.
 */
export function emailLinkedToActiveBidCandidateWhere(
  workspaceId: string
): Prisma.EmailMessageWhereInput {
  return {
    bidCandidateEmails: {
      some: {
        workspaceId,
        bidCandidate: {
          workspaceId,
          ...activeBidListLifecycleWhere(),
        },
      },
    },
  };
}
