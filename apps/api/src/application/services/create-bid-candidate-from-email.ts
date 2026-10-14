/**
 * Inbox → permanent Bid Candidate (no Job, no Job number).
 */

import type { PrismaClient } from "@prisma/client";
import { createBidCandidate } from "./create-bid-candidate.js";
import { linkEmailToBidCandidate } from "./link-email-to-bid-candidate.js";
import { PromoteBidCandidateError } from "./promote-bid-candidate.js";

export async function createBidCandidateFromEmail(input: {
  prisma: PrismaClient;
  workspaceId: string;
  userId: string;
  messageId: string;
  projectName: string;
  customerName?: string | null;
  customerId?: string | null;
  resolveCreateCustomer?: boolean;
  bidDueAt?: Date | null;
  anticipatedStartAt?: Date | null;
  scope?: string | null;
  notes?: string | null;
  externalProjectNumber?: string | null;
  role?: "BID_INVITE" | "QUOTE" | "SUPPORTING" | "ADDENDUM";
}): Promise<{
  candidateId: string;
  emailMessageId: string;
  lifecycle: "OPEN" | "QUOTED";
}> {
  const message = await input.prisma.emailMessage.findFirst({
    where: { id: input.messageId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!message) {
    throw new PromoteBidCandidateError("NOT_FOUND", "Email message not found");
  }

  const created = await createBidCandidate({
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectName: input.projectName,
    resolveCreateCustomer: input.resolveCreateCustomer === true,
    ...(input.customerName !== undefined
      ? { customerName: input.customerName }
      : {}),
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(input.bidDueAt !== undefined ? { bidDueAt: input.bidDueAt } : {}),
    ...(input.anticipatedStartAt !== undefined
      ? { anticipatedStartAt: input.anticipatedStartAt }
      : {}),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.externalProjectNumber !== undefined
      ? { externalProjectNumber: input.externalProjectNumber }
      : {}),
  });

  const role = input.role ?? "BID_INVITE";
  await linkEmailToBidCandidate({
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    candidateId: created.candidateId,
    emailMessageId: message.id,
    role,
    userConfirmed: true,
    isPrimary: role === "BID_INVITE",
    applyBidInviteSubtype: role === "BID_INVITE",
    applyQuoteSubtype: role === "QUOTE",
  });

  return {
    candidateId: created.candidateId,
    emailMessageId: message.id,
    lifecycle: role === "QUOTE" ? "QUOTED" : "OPEN",
  };
}
