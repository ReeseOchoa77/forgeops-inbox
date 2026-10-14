/**
 * Canonical Bid Candidate creation — workspace-scoped permanent opportunity.
 * No Job, no Job number, no mailbox required.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { buildBidCandidateIdentityKey, scopeDetailFromUserText } from "@forgeops/shared";
import { PromoteBidCandidateError } from "./promote-bid-candidate.js";
import { resolveOrCreateBiddingCustomer } from "./resolve-bidding-customer.js";

export type CreateBidCandidateInput = {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  userId: string;
  projectName: string;
  customerName?: string | null;
  /** When set, attach existing Customer (must belong to workspace). */
  customerId?: string | null;
  /** When true and customerName given with no customerId, create Customer if needed. */
  resolveCreateCustomer?: boolean;
  bidDueAt?: Date | null;
  anticipatedStartAt?: Date | null;
  scope?: string | null;
  notes?: string | null;
  estimatorUserId?: string | null;
  /**
   * External customer/GC project or bid identifier only.
   * Never a ForgeOps Job number.
   */
  externalProjectNumber?: string | null;
};

export type CreateBidCandidateResult = {
  candidateId: string;
  identityKey: string;
  lifecycle: "OPEN";
};

/**
 * Create a permanent Bid Candidate. Does not create a Job or assign a Job number.
 */
export async function createBidCandidate(
  input: CreateBidCandidateInput
): Promise<CreateBidCandidateResult> {
  const projectName = input.projectName.trim();
  if (!projectName) {
    throw new PromoteBidCandidateError("NAME_REQUIRED", "Project name is required");
  }

  let customerId: string | null = input.customerId?.trim() || null;
  let customerName: string | null = input.customerName?.trim() || null;

  if (customerId) {
    const existing = await input.prisma.customer.findFirst({
      where: { id: customerId, workspaceId: input.workspaceId },
      select: { id: true, name: true },
    });
    if (!existing) {
      throw new PromoteBidCandidateError(
        "FORBIDDEN",
        "Customer not found in workspace"
      );
    }
    customerName = customerName || existing.name;
  } else if (input.resolveCreateCustomer && customerName) {
    const resolved = await resolveOrCreateBiddingCustomer(
      input.prisma as Prisma.TransactionClient,
      {
        workspaceId: input.workspaceId,
        customerId: null,
        customerName,
      }
    );
    customerId = resolved.customerId;
  }

  const external = input.externalProjectNumber?.trim() || null;

  const identityKey =
    buildBidCandidateIdentityKey({
      externalProjectNumber: external,
      projectName,
      customerName,
      fallbackMessageId: `manual:${input.userId}:${Date.now()}`,
    }) ?? `manual:${input.userId}:${Date.now()}`;

  const locked: string[] = ["proposedProjectName", "lifecycle"];
  if (input.customerName !== undefined) locked.push("proposedCustomerName");
  if (customerId) locked.push("customerId");
  if (input.bidDueAt !== undefined) locked.push("proposedBidDueAt");
  if (input.anticipatedStartAt !== undefined) locked.push("anticipatedStartAt");
  if (input.scope !== undefined) {
    locked.push("proposedScope");
    locked.push("proposedScopeDetail");
  }
  if (input.notes !== undefined) locked.push("proposedNotes");
  if (input.estimatorUserId !== undefined) locked.push("proposedEstimatorUserId");
  if (external) locked.push("proposedJobNumber");

  const scopeText = input.scope?.trim() || null;
  const data: Prisma.BidCandidateUncheckedCreateInput = {
    workspaceId: input.workspaceId,
    identityKey,
    lifecycle: "OPEN",
    status: "DISCOVERED",
    proposedProjectName: projectName,
    proposedCustomerName: customerName,
    customerId,
    proposedBidDueAt: input.bidDueAt ?? null,
    anticipatedStartAt: input.anticipatedStartAt ?? null,
    proposedEstimatorUserId: input.estimatorUserId?.trim() || null,
    proposedJobNumber: external,
    proposedScope: scopeText,
    proposedNotes: input.notes?.trim() || null,
    userEditedFields: locked,
    confidence: 1,
    evidence: { labels: ["manual_create", "permanent_candidate"] },
    importBlockedReason: null,
  };
  if (scopeText) {
    data.proposedScopeDetail = scopeDetailFromUserText(
      scopeText
    ) as Prisma.InputJsonValue;
  }

  const created = await input.prisma.bidCandidate.create({
    data,
    select: { id: true, identityKey: true },
  });

  return {
    candidateId: created.id,
    identityKey: created.identityKey,
    lifecycle: "OPEN",
  };
}

/** @deprecated Use createBidCandidate. */
export async function createManualBidCandidate(input: {
  prisma: PrismaClient;
  workspaceId: string;
  projectName: string;
  customerName?: string | null;
  bidDueAt?: Date | null;
  /** Ignored — Candidates do not receive ForgeOps Job numbers. */
  jobNumber?: string | null;
  notes?: string | null;
  userId: string;
}): Promise<{ candidateId: string }> {
  const args: CreateBidCandidateInput = {
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectName: input.projectName,
  };
  if (input.customerName !== undefined) args.customerName = input.customerName;
  if (input.bidDueAt !== undefined) args.bidDueAt = input.bidDueAt;
  if (input.notes !== undefined) args.notes = input.notes;
  const result = await createBidCandidate(args);
  return { candidateId: result.candidateId };
}
