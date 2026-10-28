/**
 * Durable BidCandidate ↔ EmailMessage association.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isUserConfirmedBidCandidateEmail,
  userConfirmedBidCandidateEmailEvidence,
} from "@forgeops/shared";
import { applyDeterministicBidInviteSubtype } from "./apply-bid-invite-subtype.js";
import { applyDeterministicQuoteSubtype } from "./apply-quote-subtype.js";
import { PromoteBidCandidateError } from "./promote-bid-candidate.js";

export type BidCandidateEmailLinkRole =
  | "BID_INVITE"
  | "QUOTE"
  | "SUPPORTING"
  | "ADDENDUM";

/**
 * Link an EmailMessage to a Bid Candidate. Manual links are authoritative.
 * Does not create Jobs. Does not duplicate EmailMessage.
 */
export async function linkEmailToBidCandidate(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  candidateId: string;
  emailMessageId: string;
  role?: BidCandidateEmailLinkRole;
  /** When true, marks association as user-confirmed (survives analysis). */
  userConfirmed?: boolean;
  isPrimary?: boolean;
  applyBidInviteSubtype?: boolean;
  applyQuoteSubtype?: boolean;
  /**
   * When true, replace an existing user-confirmed link on another Candidate
   * (Inbox "correct association"). Default false preserves other manual links.
   */
  forceReassign?: boolean;
}): Promise<{ candidateId: string; emailMessageId: string }> {
  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    select: { id: true, lifecycle: true },
  });
  if (!candidate) {
    throw new PromoteBidCandidateError("NOT_FOUND", "Bid Candidate not found");
  }

  const message = await input.prisma.emailMessage.findFirst({
    where: { id: input.emailMessageId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!message) {
    throw new PromoteBidCandidateError("NOT_FOUND", "Email message not found");
  }

  const role = input.role ?? "BID_INVITE";
  const userConfirmed = input.userConfirmed !== false;
  const evidence = userConfirmed
    ? userConfirmedBidCandidateEmailEvidence("inbox_manual")
    : { labels: ["analysis_link"], source: "analysis" };

  // If already linked elsewhere with user confirmation, do not steal the link.
  const otherLinks = await input.prisma.bidCandidateEmail.findMany({
    where: {
      workspaceId: input.workspaceId,
      emailMessageId: message.id,
      bidCandidateId: { not: candidate.id },
    },
    select: { id: true, bidCandidateId: true, matchEvidence: true },
  });
  for (const link of otherLinks) {
    if (
      isUserConfirmedBidCandidateEmail(link.matchEvidence) &&
      !input.forceReassign
    ) {
      throw new PromoteBidCandidateError(
        "FORBIDDEN",
        "Email is manually linked to another Bid Candidate — unlink first"
      );
    }
    // Drop prior links so the new association wins (manual reassignment or analysis).
    await input.prisma.bidCandidateEmail.delete({ where: { id: link.id } });
  }

  // Also re-home Quote staging when forcing a Quote reassignment.
  if (role === "QUOTE" && input.forceReassign) {
    await input.prisma.bidQuoteStaging.updateMany({
      where: {
        workspaceId: input.workspaceId,
        emailMessageId: message.id,
        bidCandidateId: { not: candidate.id },
      },
      data: {
        bidCandidateId: candidate.id,
        matchStatus: "MATCHED",
        isDurable: true,
        userConfirmedMatch: userConfirmed,
        ...(userConfirmed ? { matchConfidence: 1 } : {}),
      },
    });
  }

  const isPrimary = input.isPrimary ?? role === "BID_INVITE";
  await input.prisma.bidCandidateEmail.upsert({
    where: {
      bidCandidateId_emailMessageId: {
        bidCandidateId: candidate.id,
        emailMessageId: message.id,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      bidCandidateId: candidate.id,
      emailMessageId: message.id,
      role,
      isPrimary,
      matchConfidence: userConfirmed ? 1 : null,
      matchEvidence: evidence as Prisma.InputJsonValue,
    },
    update: {
      role,
      isPrimary,
      ...(userConfirmed ? { matchConfidence: 1 } : {}),
      matchEvidence: evidence as Prisma.InputJsonValue,
    },
  });

  if (role === "QUOTE") {
    // Ensure durable Quote staging row when one already exists for this email.
    const staging = await input.prisma.bidQuoteStaging.findFirst({
      where: {
        workspaceId: input.workspaceId,
        emailMessageId: message.id,
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (staging) {
      await input.prisma.bidQuoteStaging.update({
        where: { id: staging.id },
        data: {
          bidCandidateId: candidate.id,
          matchStatus: "MATCHED",
          isDurable: true,
          ...(userConfirmed
            ? { userConfirmedMatch: true, matchConfidence: 1 }
            : {}),
          matchEvidence: evidence as Prisma.InputJsonValue,
        },
      });
    }

    // OPEN → QUOTED only; never overwrite CONVERTED / LOST / ARCHIVED.
    if (candidate.lifecycle === "OPEN") {
      await input.prisma.bidCandidate.update({
        where: { id: candidate.id },
        data: { lifecycle: "QUOTED" },
      });
    }

    if (input.applyQuoteSubtype !== false) {
      await applyDeterministicQuoteSubtype({
        prisma: input.prisma,
        workspaceId: input.workspaceId,
        emailMessageIds: [message.id],
      });
    }
  } else if (input.applyBidInviteSubtype !== false && role === "BID_INVITE") {
    // Manual Assign must NOT stamp Projects/Bid Invites folder provenance.
    // Inbox Active Bid uses BidCandidateEmail membership, not that flag.
    await applyDeterministicBidInviteSubtype({
      prisma: input.prisma,
      workspaceId: input.workspaceId,
      emailMessageIds: [message.id],
      recordFolderProvenance: false,
    });
  }

  return { candidateId: candidate.id, emailMessageId: message.id };
}
