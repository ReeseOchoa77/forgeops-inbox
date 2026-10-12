/**
 * Explicit human confirmation: promote BidCandidate → canonical BIDDING Job.
 * Analysis never calls this.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { dedupeProjectAliases, normalizeName } from "@forgeops/shared";
import { ACTIVE_BID_STATUS, USER_BID_ASSIGNMENT } from "./bidding.js";
import { resolveOrCreateBiddingCustomer } from "./resolve-bidding-customer.js";

export class PromoteBidCandidateError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "ALREADY_CONFIRMED"
    | "REJECTED"
    | "FORBIDDEN"
    | "NAME_REQUIRED"
    | "EXISTING_JOB"
    | "JOB_NUMBER_TAKEN"
    | "ATTACH_JOB_NOT_FOUND";

  readonly causePayload?: unknown;

  constructor(
    code: PromoteBidCandidateError["code"],
    message: string,
    causePayload?: unknown
  ) {
    super(message);
    this.name = "PromoteBidCandidateError";
    this.code = code;
    this.causePayload = causePayload;
  }
}

export function canPromoteBidCandidate(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export type PromoteBidCandidateInput = {
  prisma: PrismaClient;
  workspaceId: string;
  candidateId: string;
  userId: string;
  /** create = new Job; attach = reuse existingJobId */
  mode: "create" | "attach";
  existingJobId?: string | null;
  /** Overrides for editable review fields */
  projectName?: string | null;
  customerName?: string | null;
  customerId?: string | null;
  bidDueAt?: Date | null;
  jobNumber?: string | null;
  estimatorUserId?: string | null;
  alternateProjectNames?: string[];
  /** Required when an exact/likely Job exists and mode is create */
  confirmCreateDespiteExisting?: boolean;
};

export type PromoteBidCandidateResult = {
  candidateId: string;
  jobId: string;
  created: boolean;
  attachedEmailCount: number;
};

export async function findLikelyExistingJobs(
  prisma: PrismaClient | Prisma.TransactionClient,
  workspaceId: string,
  input: {
    projectName: string;
    jobNumber?: string | null;
  }
): Promise<Array<{ id: string; name: string; jobNumber: string | null; status: string }>> {
  const normalized = normalizeName(input.projectName);
  const byName = normalized
    ? await prisma.job.findMany({
        where: { workspaceId, normalizedName: normalized, archivedAt: null },
        select: { id: true, name: true, jobNumber: true, status: true },
        take: 5,
      })
    : [];
  if (input.jobNumber?.trim()) {
    const byNum = await prisma.job.findMany({
      where: {
        workspaceId,
        jobNumber: input.jobNumber.trim(),
        archivedAt: null,
      },
      select: { id: true, name: true, jobNumber: true, status: true },
      take: 5,
    });
    const seen = new Set(byName.map((j) => j.id));
    for (const j of byNum) {
      if (!seen.has(j.id)) byName.push(j);
    }
  }
  return byName;
}

/**
 * Transactional promotion. Idempotent: repeated Create Bid on CONFIRMED returns same Job.
 */
export async function promoteBidCandidate(
  input: PromoteBidCandidateInput
): Promise<PromoteBidCandidateResult> {
  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    include: {
      emails: {
        select: { emailMessageId: true, role: true },
      },
    },
  });

  if (!candidate) {
    throw new PromoteBidCandidateError("NOT_FOUND", "Bid candidate not found");
  }

  if (candidate.status === "CONFIRMED" && candidate.canonicalJobId) {
    return {
      candidateId: candidate.id,
      jobId: candidate.canonicalJobId,
      created: false,
      attachedEmailCount: candidate.emails.length,
    };
  }

  if (candidate.status === "REJECTED") {
    throw new PromoteBidCandidateError(
      "REJECTED",
      "Rejected candidates cannot be promoted"
    );
  }

  const projectName =
    input.projectName?.trim() || candidate.proposedProjectName?.trim() || "";
  if (!projectName) {
    throw new PromoteBidCandidateError(
      "NAME_REQUIRED",
      "Project name is required to create a bid"
    );
  }

  const jobNumber =
    input.jobNumber?.trim() || candidate.proposedJobNumber?.trim() || null;
  const bidDueAt =
    input.bidDueAt !== undefined ? input.bidDueAt : candidate.proposedBidDueAt;
  const customerName =
    input.customerName !== undefined
      ? input.customerName
      : candidate.proposedCustomerName;
  const estimatorUserId =
    input.estimatorUserId !== undefined
      ? input.estimatorUserId
      : candidate.proposedEstimatorUserId;

  if (input.mode === "attach") {
    const existingId = input.existingJobId?.trim();
    if (!existingId) {
      throw new PromoteBidCandidateError(
        "ATTACH_JOB_NOT_FOUND",
        "existingJobId is required to attach"
      );
    }
    const existing = await input.prisma.job.findFirst({
      where: { id: existingId, workspaceId: input.workspaceId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new PromoteBidCandidateError(
        "ATTACH_JOB_NOT_FOUND",
        "Existing Job not found"
      );
    }

    return input.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: existing.id },
        data: {
          status: ACTIVE_BID_STATUS,
          ...(bidDueAt ? { bidDueAt } : {}),
          ...(jobNumber ? { jobNumber } : {}),
        },
      });

      const emailIds = candidate.emails.map((e) => e.emailMessageId);
      if (emailIds.length > 0) {
        await tx.emailMessage.updateMany({
          where: { workspaceId: input.workspaceId, id: { in: emailIds } },
          data: {
            jobId: existing.id,
            ...USER_BID_ASSIGNMENT,
            jobAssignedAt: new Date(),
            jobAssignedByUserId: input.userId,
          },
        });
      }

      await tx.bidCandidate.update({
        where: { id: candidate.id },
        data: {
          status: "CONFIRMED",
          canonicalJobId: existing.id,
          confirmedAt: new Date(),
          confirmedByUserId: input.userId,
          proposedProjectName: projectName,
          proposedCustomerName: customerName,
          proposedBidDueAt: bidDueAt,
          proposedJobNumber: jobNumber,
          proposedEstimatorUserId: estimatorUserId,
        },
      });

      return {
        candidateId: candidate.id,
        jobId: existing.id,
        created: false,
        attachedEmailCount: emailIds.length,
      };
    });
  }

  // mode === create
  const likely = await findLikelyExistingJobs(input.prisma, input.workspaceId, {
    projectName,
    jobNumber,
  });
  if (likely.length > 0 && !input.confirmCreateDespiteExisting) {
    throw new PromoteBidCandidateError(
      "EXISTING_JOB",
      `Possible existing Job: ${likely
        .map((j) =>
          j.jobNumber ? `${j.jobNumber} — ${j.name}` : j.name
        )
        .join("; ")}`,
      { existingJobs: likely }
    );
  }

  if (jobNumber) {
    const taken = await input.prisma.job.findFirst({
      where: { workspaceId: input.workspaceId, jobNumber },
      select: { id: true, name: true, jobNumber: true },
    });
    if (taken && !input.confirmCreateDespiteExisting) {
      throw new PromoteBidCandidateError(
        "JOB_NUMBER_TAKEN",
        `Job number ${jobNumber} is already in use`,
        { existingJobs: [taken] }
      );
    }
  }

  const now = new Date();
  const normalized = normalizeName(projectName);

  return input.prisma.$transaction(async (tx) => {
    const resolved = await resolveOrCreateBiddingCustomer(tx, {
      workspaceId: input.workspaceId,
      customerId: input.customerId ?? null,
      customerName: customerName ?? null,
    });

    const job = await tx.job.create({
      data: {
        workspaceId: input.workspaceId,
        name: projectName,
        normalizedName: normalized,
        jobNumber,
        customerId: resolved.customerId,
        status: ACTIVE_BID_STATUS,
        bidDueAt: bidDueAt ?? null,
        createdByUserId: input.userId,
      },
      select: { id: true },
    });

    const aliases = dedupeProjectAliases(
      projectName,
      input.alternateProjectNames ?? []
    );
    if (aliases.length > 0) {
      await tx.entityAlias.createMany({
        data: aliases.map((alias) => ({
          workspaceId: input.workspaceId,
          entityType: "JOB" as const,
          jobId: job.id,
          alias,
          normalizedAlias: normalizeName(alias),
          source: "REVIEW" as const,
        })),
        skipDuplicates: true,
      });
    }

    const emailIds = candidate.emails.map((e) => e.emailMessageId);
    if (emailIds.length > 0) {
      await tx.emailMessage.updateMany({
        where: { workspaceId: input.workspaceId, id: { in: emailIds } },
        data: {
          jobId: job.id,
          ...USER_BID_ASSIGNMENT,
          jobAssignedAt: now,
          jobAssignedByUserId: input.userId,
        },
      });
    }

    await tx.jobActivityLog.create({
      data: {
        jobId: job.id,
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        action: "JOB_CREATED",
        newValue: {
          status: ACTIVE_BID_STATUS,
          source: "bid_candidate_promote",
          bidCandidateId: candidate.id,
        },
      },
    });

    await tx.bidCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "CONFIRMED",
        canonicalJobId: job.id,
        confirmedAt: now,
        confirmedByUserId: input.userId,
        proposedProjectName: projectName,
        proposedCustomerName: customerName,
        proposedBidDueAt: bidDueAt,
        proposedJobNumber: jobNumber,
        proposedEstimatorUserId: estimatorUserId,
      },
    });

    return {
      candidateId: candidate.id,
      jobId: job.id,
      created: true,
      attachedEmailCount: emailIds.length,
    };
  });
}

export async function rejectBidCandidate(input: {
  prisma: PrismaClient;
  workspaceId: string;
  candidateId: string;
  userId: string;
  reviewNotes?: string | null;
}): Promise<{ candidateId: string }> {
  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    select: { id: true, status: true },
  });
  if (!candidate) {
    throw new PromoteBidCandidateError("NOT_FOUND", "Bid candidate not found");
  }
  if (candidate.status === "CONFIRMED") {
    throw new PromoteBidCandidateError(
      "ALREADY_CONFIRMED",
      "Confirmed candidates cannot be rejected"
    );
  }
  await input.prisma.bidCandidate.update({
    where: { id: candidate.id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      ...(input.reviewNotes != null ? { reviewNotes: input.reviewNotes } : {}),
    },
  });
  return { candidateId: candidate.id };
}

export async function updateBidCandidateReview(input: {
  prisma: PrismaClient;
  workspaceId: string;
  candidateId: string;
  projectName?: string | null;
  customerName?: string | null;
  bidDueAt?: Date | null;
  jobNumber?: string | null;
  estimatorUserId?: string | null;
  status?: "READY" | "NEEDS_REVIEW" | "DISCOVERED";
  reviewNotes?: string | null;
}): Promise<{ candidateId: string }> {
  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    select: { id: true, status: true },
  });
  if (!candidate) {
    throw new PromoteBidCandidateError("NOT_FOUND", "Bid candidate not found");
  }
  if (candidate.status === "CONFIRMED" || candidate.status === "REJECTED") {
    throw new PromoteBidCandidateError(
      "ALREADY_CONFIRMED",
      "Confirmed/rejected candidates cannot be edited here"
    );
  }
  await input.prisma.bidCandidate.update({
    where: { id: candidate.id },
    data: {
      ...(input.projectName !== undefined
        ? { proposedProjectName: input.projectName }
        : {}),
      ...(input.customerName !== undefined
        ? { proposedCustomerName: input.customerName }
        : {}),
      ...(input.bidDueAt !== undefined ? { proposedBidDueAt: input.bidDueAt } : {}),
      ...(input.jobNumber !== undefined
        ? { proposedJobNumber: input.jobNumber }
        : {}),
      ...(input.estimatorUserId !== undefined
        ? { proposedEstimatorUserId: input.estimatorUserId }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.reviewNotes !== undefined
        ? { reviewNotes: input.reviewNotes }
        : {}),
    },
  });
  return { candidateId: candidate.id };
}
