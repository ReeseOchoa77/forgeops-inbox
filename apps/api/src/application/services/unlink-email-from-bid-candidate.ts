/**
 * Remove BidCandidateEmail only. Never deletes EmailMessage.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { OperationalBidCandidateError } from "./update-operational-bid-candidate.js";

export async function unlinkEmailFromBidCandidate(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  candidateId: string;
  emailMessageId: string;
}): Promise<{ candidateId: string; emailMessageId: string; unlinked: boolean }> {
  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!candidate) {
    throw new OperationalBidCandidateError("NOT_FOUND", "Bid Candidate not found");
  }

  const message = await input.prisma.emailMessage.findFirst({
    where: { id: input.emailMessageId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!message) {
    throw new OperationalBidCandidateError("NOT_FOUND", "Email message not found");
  }

  const deleted = await input.prisma.bidCandidateEmail.deleteMany({
    where: {
      workspaceId: input.workspaceId,
      bidCandidateId: candidate.id,
      emailMessageId: message.id,
    },
  });

  await input.prisma.bidQuoteStaging.updateMany({
    where: {
      workspaceId: input.workspaceId,
      bidCandidateId: candidate.id,
      emailMessageId: message.id,
    },
    data: {
      bidCandidateId: null,
      matchStatus: "USER_UNMATCHED",
      userConfirmedMatch: true,
    },
  });

  return {
    candidateId: candidate.id,
    emailMessageId: message.id,
    unlinked: deleted.count > 0,
  };
}
