/**
 * Legacy promote API surface — delegates to Convert to Job (ACTIVE Job).
 * Prefer convertBidCandidateToJob / POST .../convert-to-job for new callers.
 * Analysis never auto-calls this.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { scopeDetailFromUserText } from "@forgeops/shared";
import type { BidImportEmailConflict } from "./associate-bid-import-emails.js";
import { computeImportBlockedReason } from "./bid-import-eligibility.js";
import {
  convertBidCandidateToJob,
  ConvertBidCandidateError,
} from "./convert-bid-candidate-to-job.js";
import { suggestNextJobNumberForWorkspace } from "./bidding-intake-suggestions.js";

export { findLikelyExistingJobs } from "./convert-bid-candidate-to-job.js";
export {
  convertBidCandidateToJob,
  previewConvertBidCandidateToJob,
  canConvertBidCandidateToJob,
  ConvertBidCandidateError,
  CONVERTED_JOB_STATUS,
} from "./convert-bid-candidate-to-job.js";

export class PromoteBidCandidateError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "ALREADY_CONFIRMED"
    | "REJECTED"
    | "FORBIDDEN"
    | "NAME_REQUIRED"
    | "EXISTING_JOB"
    | "JOB_NUMBER_TAKEN"
    | "ATTACH_JOB_NOT_FOUND"
    | "NOT_CONVERTIBLE"
    | "JOB_NUMBER_REQUIRED"
    | "CONCURRENT_CONVERSION";

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

/** @deprecated Prefer canConvertBidCandidateToJob(workspaceRole) for Convert to Job. */
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
  startDate?: Date | null;
  description?: string | null;
  notes?: string | null;
  jobNumber?: string | null;
  estimatorUserId?: string | null;
  alternateProjectNames?: string[];
  /** Required when an exact/likely Job exists and mode is create */
  confirmCreateDespiteExisting?: boolean;
  /**
   * When attaching: only link emails;
   * do not overwrite Job name/customer/due/jobNumber (import RESOLVED_SAME).
   */
  preserveJobFields?: boolean;
};

export type PromoteBidCandidateResult = {
  candidateId: string;
  jobId: string;
  created: boolean;
  attachedEmailCount: number;
  /** Protected emails already on another Job — not moved. */
  emailConflicts: BidImportEmailConflict[];
};

function mapConvertError(e: ConvertBidCandidateError): PromoteBidCandidateError {
  const codeMap: Record<
    ConvertBidCandidateError["code"],
    PromoteBidCandidateError["code"]
  > = {
    NOT_FOUND: "NOT_FOUND",
    ALREADY_CONVERTED: "ALREADY_CONFIRMED",
    NOT_CONVERTIBLE: "NOT_CONVERTIBLE",
    FORBIDDEN: "FORBIDDEN",
    NAME_REQUIRED: "NAME_REQUIRED",
    JOB_NUMBER_REQUIRED: "JOB_NUMBER_REQUIRED",
    JOB_NUMBER_TAKEN: "JOB_NUMBER_TAKEN",
    EXISTING_JOB: "EXISTING_JOB",
    ATTACH_JOB_NOT_FOUND: "ATTACH_JOB_NOT_FOUND",
    CONCURRENT_CONVERSION: "CONCURRENT_CONVERSION",
  };
  return new PromoteBidCandidateError(
    codeMap[e.code] ?? "FORBIDDEN",
    e.message,
    e.causePayload
  );
}

/**
 * Delegates to convertBidCandidateToJob (ACTIVE Job, not BIDDING).
 * Create mode auto-suggests a Job number when omitted (legacy Import callers).
 */
export async function promoteBidCandidate(
  input: PromoteBidCandidateInput
): Promise<PromoteBidCandidateResult> {
  try {
    let jobNumber = input.jobNumber?.trim() || null;
    if (input.mode === "create" && !jobNumber) {
      jobNumber = await suggestNextJobNumberForWorkspace(
        input.prisma,
        input.workspaceId
      );
    }

    const result = await convertBidCandidateToJob({
      prisma: input.prisma,
      workspaceId: input.workspaceId,
      candidateId: input.candidateId,
      userId: input.userId,
      mode: input.mode,
      existingJobId: input.existingJobId,
      projectName: input.projectName,
      customerName: input.customerName,
      customerId: input.customerId,
      bidDueAt: input.bidDueAt,
      startDate: input.startDate,
      description: input.description,
      notes: input.notes,
      jobNumber,
      estimatorUserId: input.estimatorUserId,
      alternateProjectNames: input.alternateProjectNames,
      confirmCreateDespiteExisting: input.confirmCreateDespiteExisting,
      preserveJobFields: input.preserveJobFields,
    });

    return {
      candidateId: result.candidateId,
      jobId: result.jobId,
      created: result.created,
      attachedEmailCount: result.attachedEmailCount,
      emailConflicts: result.emailConflicts,
    };
  } catch (e) {
    if (e instanceof ConvertBidCandidateError) {
      throw mapConvertError(e);
    }
    throw e;
  }
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
      // Analysis reject → business lost (still permanent; Clear Analysis won't delete).
      lifecycle: "LOST",
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
  scope?: string | null;
  notes?: string | null;
  status?: "READY" | "NEEDS_REVIEW" | "DISCOVERED";
  reviewNotes?: string | null;
}): Promise<{ candidateId: string }> {
  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    select: {
      id: true,
      status: true,
      userEditedFields: true,
      proposedProjectName: true,
      existingJobMatchStatus: true,
    },
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

  const locked = new Set(
    Array.isArray(candidate.userEditedFields)
      ? candidate.userEditedFields.filter((k): k is string => typeof k === "string")
      : []
  );
  if (input.projectName !== undefined) locked.add("proposedProjectName");
  if (input.customerName !== undefined) locked.add("proposedCustomerName");
  if (input.bidDueAt !== undefined) locked.add("proposedBidDueAt");
  if (input.jobNumber !== undefined) locked.add("proposedJobNumber");
  if (input.scope !== undefined) {
    locked.add("proposedScope");
    locked.add("proposedScopeDetail");
  }
  if (input.notes !== undefined) locked.add("proposedNotes");

  const nextName =
    input.projectName !== undefined
      ? input.projectName
      : candidate.proposedProjectName;
  const nextStatus = input.status ?? candidate.status;

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
      ...(input.scope !== undefined
        ? {
            proposedScope: input.scope,
            proposedScopeDetail: scopeDetailFromUserText(
              input.scope
            ) as unknown as Prisma.InputJsonValue,
          }
        : {}),
      ...(input.notes !== undefined ? { proposedNotes: input.notes } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.reviewNotes !== undefined
        ? { reviewNotes: input.reviewNotes }
        : {}),
      userEditedFields: [...locked] as Prisma.InputJsonValue,
      importBlockedReason: computeImportBlockedReason({
        status: nextStatus,
        proposedProjectName: nextName,
        existingJobMatchStatus: candidate.existingJobMatchStatus,
      }),
    },
  });
  return { candidateId: candidate.id };
}

export async function resolveBidCandidateExistingJob(input: {
  prisma: PrismaClient;
  workspaceId: string;
  candidateId: string;
  resolution: "SAME" | "DIFFERENT" | "NEEDS_REVIEW";
  existingJobId?: string | null;
}): Promise<{ candidateId: string; existingJobMatchStatus: string }> {
  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    select: {
      id: true,
      status: true,
      proposedProjectName: true,
      proposedBidDueAt: true,
      proposedExistingJobId: true,
    },
  });
  if (!candidate) {
    throw new PromoteBidCandidateError("NOT_FOUND", "Bid candidate not found");
  }
  if (candidate.status === "CONFIRMED" || candidate.status === "REJECTED") {
    throw new PromoteBidCandidateError(
      "ALREADY_CONFIRMED",
      "Confirmed/rejected candidates cannot resolve existing Job here"
    );
  }

  let existingJobMatchStatus:
    | "RESOLVED_SAME"
    | "RESOLVED_DIFFERENT"
    | "NEEDS_REVIEW" = "NEEDS_REVIEW";
  let proposedExistingJobId = candidate.proposedExistingJobId;

  if (input.resolution === "SAME") {
    const jobId = input.existingJobId?.trim() || candidate.proposedExistingJobId;
    if (!jobId) {
      throw new PromoteBidCandidateError(
        "ATTACH_JOB_NOT_FOUND",
        "existingJobId is required to resolve as same Job"
      );
    }
    const job = await input.prisma.job.findFirst({
      where: { id: jobId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!job) {
      throw new PromoteBidCandidateError(
        "ATTACH_JOB_NOT_FOUND",
        "Existing Job not found"
      );
    }
    existingJobMatchStatus = "RESOLVED_SAME";
    proposedExistingJobId = job.id;
  } else if (input.resolution === "DIFFERENT") {
    existingJobMatchStatus = "RESOLVED_DIFFERENT";
  } else {
    existingJobMatchStatus = "NEEDS_REVIEW";
  }

  const nextStatus =
    existingJobMatchStatus === "NEEDS_REVIEW"
      ? "NEEDS_REVIEW"
      : candidate.proposedProjectName && candidate.proposedBidDueAt
        ? "READY"
        : candidate.proposedProjectName
          ? "DISCOVERED"
          : "NEEDS_REVIEW";

  await input.prisma.bidCandidate.update({
    where: { id: candidate.id },
    data: {
      existingJobMatchStatus,
      proposedExistingJobId,
      status: nextStatus,
      importBlockedReason: computeImportBlockedReason({
        status: nextStatus,
        proposedProjectName: candidate.proposedProjectName,
        existingJobMatchStatus,
      }),
    },
  });

  return { candidateId: candidate.id, existingJobMatchStatus };
}

export {
  createBidCandidate,
  createManualBidCandidate,
} from "./create-bid-candidate.js";
