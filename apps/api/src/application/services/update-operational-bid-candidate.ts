/**
 * Operational BidCandidate PATCH — user edits are authoritative (userEditedFields).
 * Does not write Jobs. CONVERTED lifecycle is only via Convert to Job.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  detailedScopeFromUserLists,
  scopeDetailFromUserText,
} from "@forgeops/shared";

export class OperationalBidCandidateError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID" | "FORBIDDEN",
    message: string
  ) {
    super(message);
    this.name = "OperationalBidCandidateError";
  }
}

export type OperationalBidCandidateLifecycleEdit =
  | "OPEN"
  | "QUOTED"
  | "LOST"
  | "ARCHIVED";

export type OperationalScopeDetailEdit = {
  tradeCategory?: string | null | undefined;
  summary?: string | null | undefined;
  items?: string[] | undefined;
  work?: string[] | undefined;
  exclusions?: string[] | undefined;
  qualifications?: string[] | undefined;
};

export async function updateOperationalBidCandidate(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  candidateId: string;
  projectName?: string;
  customerName?: string | null;
  customerId?: string | null;
  bidDueAt?: Date | null;
  anticipatedStartAt?: Date | null;
  scope?: string | null;
  scopeDetail?: OperationalScopeDetailEdit;
  notes?: string | null;
  lifecycle?: OperationalBidCandidateLifecycleEdit;
  estimatorUserId?: string | null;
  externalProjectNumber?: string | null;
}): Promise<{ candidateId: string }> {
  const existing = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    select: {
      id: true,
      userEditedFields: true,
      canonicalJobId: true,
      lifecycle: true,
    },
  });
  if (!existing) {
    throw new OperationalBidCandidateError("NOT_FOUND", "Bid Candidate not found");
  }

  if ((input.lifecycle as string | undefined) === "CONVERTED") {
    throw new OperationalBidCandidateError(
      "INVALID",
      "CONVERTED is only set by Convert to Job"
    );
  }
  if (input.lifecycle !== undefined && existing.lifecycle === "CONVERTED") {
    throw new OperationalBidCandidateError(
      "INVALID",
      "Converted Candidates cannot change lifecycle here. Use historical Job as canonical."
    );
  }

  let resolvedCustomerName: string | null | undefined;
  if (input.customerId) {
    const cust = await input.prisma.customer.findFirst({
      where: { id: input.customerId, workspaceId: input.workspaceId },
      select: { id: true, name: true },
    });
    if (!cust) {
      throw new OperationalBidCandidateError("INVALID", "Customer not found");
    }
    if (input.customerName === undefined) {
      resolvedCustomerName = cust.name;
    }
  } else if (input.customerId === null && input.customerName === undefined) {
    resolvedCustomerName = null;
  }

  if (input.estimatorUserId) {
    const member = await input.prisma.membership.findFirst({
      where: {
        workspaceId: input.workspaceId,
        userId: input.estimatorUserId,
      },
      select: { id: true },
    });
    if (!member) {
      throw new OperationalBidCandidateError(
        "INVALID",
        "Estimator is not a workspace member"
      );
    }
  }

  const locked = new Set(
    Array.isArray(existing.userEditedFields)
      ? existing.userEditedFields.filter(
          (k): k is string => typeof k === "string"
        )
      : []
  );

  if (input.projectName !== undefined) locked.add("proposedProjectName");
  if (input.customerName !== undefined || resolvedCustomerName !== undefined) {
    locked.add("proposedCustomerName");
  }
  if (input.customerId !== undefined) locked.add("customerId");
  if (input.bidDueAt !== undefined) locked.add("proposedBidDueAt");
  if (input.anticipatedStartAt !== undefined) locked.add("anticipatedStartAt");
  if (input.scope !== undefined || input.scopeDetail !== undefined) {
    locked.add("proposedScope");
    locked.add("proposedScopeDetail");
  }
  if (input.notes !== undefined) locked.add("proposedNotes");
  if (input.lifecycle !== undefined) locked.add("lifecycle");
  if (input.estimatorUserId !== undefined) locked.add("proposedEstimatorUserId");
  if (input.externalProjectNumber !== undefined) {
    locked.add("proposedJobNumber");
  }

  const data: Prisma.BidCandidateUncheckedUpdateInput = {
    userEditedFields: [...locked],
  };
  if (input.projectName !== undefined) {
    data.proposedProjectName = input.projectName;
  }
  if (input.customerName !== undefined) {
    data.proposedCustomerName = input.customerName;
  } else if (resolvedCustomerName !== undefined) {
    data.proposedCustomerName = resolvedCustomerName;
  }
  if (input.customerId !== undefined) data.customerId = input.customerId;
  if (input.bidDueAt !== undefined) data.proposedBidDueAt = input.bidDueAt;
  if (input.anticipatedStartAt !== undefined) {
    data.anticipatedStartAt = input.anticipatedStartAt;
  }
  if (input.scopeDetail !== undefined) {
    const detail = detailedScopeFromUserLists({
      tradeCategory: input.scopeDetail.tradeCategory ?? null,
      summary: input.scopeDetail.summary ?? null,
      items: input.scopeDetail.items ?? [],
      work: input.scopeDetail.work ?? [],
      exclusions: input.scopeDetail.exclusions ?? [],
      qualifications: input.scopeDetail.qualifications ?? [],
    });
    data.proposedScopeDetail = detail as unknown as Prisma.InputJsonValue;
    data.proposedScope = detail.summary ?? input.scopeDetail.summary ?? null;
  } else if (input.scope !== undefined) {
    data.proposedScope = input.scope;
    data.proposedScopeDetail = input.scope
      ? (scopeDetailFromUserText(input.scope) as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;
  }
  if (input.notes !== undefined) data.proposedNotes = input.notes;
  if (input.lifecycle !== undefined) data.lifecycle = input.lifecycle;
  if (input.estimatorUserId !== undefined) {
    data.proposedEstimatorUserId = input.estimatorUserId;
  }
  if (input.externalProjectNumber !== undefined) {
    data.proposedJobNumber = input.externalProjectNumber;
  }

  await input.prisma.bidCandidate.update({
    where: { id: existing.id },
    data,
  });

  return { candidateId: existing.id };
}
