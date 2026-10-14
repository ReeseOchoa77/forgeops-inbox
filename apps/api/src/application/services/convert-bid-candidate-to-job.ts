/**
 * Convert Bid Candidate → actual Job (explicit human action).
 *
 * Evolves the former promoteBidCandidate create path:
 * - Job.status = ACTIVE (not BIDDING)
 * - ForgeOps Job number assigned only at commit (never from proposedJobNumber)
 * - lifecycle OPEN|QUOTED only; CONVERTED + canonicalJobId is idempotent
 * - Concurrent conversions: SELECT FOR UPDATE + conditional candidate update
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  dedupeProjectAliases,
  formatScopeSummary,
  normalizeName,
  parseDetailedScope,
} from "@forgeops/shared";
import {
  associateBidImportEmails,
  collectBidCandidateImportEmailIds,
  type BidImportEmailConflict,
} from "./associate-bid-import-emails.js";
import { suggestNextJobNumberForWorkspace } from "./bidding-intake-suggestions.js";
import { resolveOrCreateBiddingCustomer } from "./resolve-bidding-customer.js";

/** Actual Job after conversion — schema default for new projects (not BIDDING). */
export const CONVERTED_JOB_STATUS = "ACTIVE" as const;

const CONVERTIBLE_LIFECYCLES = ["OPEN", "QUOTED"] as const;

export class ConvertBidCandidateError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "ALREADY_CONVERTED"
    | "NOT_CONVERTIBLE"
    | "FORBIDDEN"
    | "NAME_REQUIRED"
    | "JOB_NUMBER_REQUIRED"
    | "JOB_NUMBER_TAKEN"
    | "EXISTING_JOB"
    | "ATTACH_JOB_NOT_FOUND"
    | "CONCURRENT_CONVERSION";

  readonly causePayload?: unknown;

  constructor(
    code: ConvertBidCandidateError["code"],
    message: string,
    causePayload?: unknown
  ) {
    super(message);
    this.name = "ConvertBidCandidateError";
    this.code = code;
    this.causePayload = causePayload;
  }
}

/** Same authority as canonical Job create (jobs.route canEdit). */
export function canConvertBidCandidateToJob(workspaceRole: string): boolean {
  return workspaceRole === "OWNER" || workspaceRole === "EDITOR";
}

export type ConvertBidCandidatePreview = {
  candidateId: string;
  lifecycle: string;
  convertible: boolean;
  alreadyConverted: boolean;
  existingJobId: string | null;
  projectName: string;
  customerId: string | null;
  customerName: string | null;
  suggestedJobNumber: string | null;
  startDate: string | null;
  bidDueAt: string | null;
  scopeSummary: string | null;
  notes: string | null;
  estimatorUserId: string | null;
  externalProjectNumber: string | null;
  emailCount: number;
  quoteCount: number;
  carryForward: {
    emails: boolean;
    quotes: boolean;
    attachmentsViaEmails: boolean;
    aliases: boolean;
    notes: boolean;
    scope: boolean;
  };
};

export type ConvertBidCandidateInput = {
  prisma: PrismaClient;
  workspaceId: string;
  candidateId: string;
  userId: string;
  projectName?: string | null | undefined;
  customerName?: string | null | undefined;
  customerId?: string | null | undefined;
  /** Required for create — ForgeOps Job number (not proposedJobNumber). */
  jobNumber?: string | null | undefined;
  startDate?: Date | null | undefined;
  bidDueAt?: Date | null | undefined;
  description?: string | null | undefined;
  notes?: string | null | undefined;
  estimatorUserId?: string | null | undefined;
  alternateProjectNames?: string[] | undefined;
  confirmCreateDespiteExisting?: boolean | undefined;
  /** attach = link to existing Job (resolved same); create = new ACTIVE Job */
  mode?: "create" | "attach" | undefined;
  existingJobId?: string | null | undefined;
  /** Attach only: do not overwrite Job identity fields */
  preserveJobFields?: boolean | undefined;
};

export type ConvertBidCandidateResult = {
  candidateId: string;
  jobId: string;
  jobNumber: string | null;
  jobName: string;
  jobStatus: string;
  created: boolean;
  reused: boolean;
  attachedEmailCount: number;
  emailConflicts: BidImportEmailConflict[];
};

function jobDescriptionFromCandidateScope(input: {
  proposedScope: string | null;
  proposedScopeDetail: unknown;
  override?: string | null;
}): string | null {
  if (input.override !== undefined) {
    const t = input.override?.trim();
    return t || null;
  }
  const summary = input.proposedScope?.trim() || null;
  const detail = parseDetailedScope(input.proposedScopeDetail);
  if (detail) {
    const formatted = formatScopeSummary(detail)?.trim() || null;
    if (formatted && summary && formatted !== summary) {
      return `${summary}\n\n${formatted}`;
    }
    return formatted || summary;
  }
  return summary;
}

export async function previewConvertBidCandidateToJob(input: {
  prisma: PrismaClient;
  workspaceId: string;
  candidateId: string;
}): Promise<ConvertBidCandidatePreview> {
  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    include: {
      customer: { select: { id: true, name: true } },
      emails: { select: { id: true } },
      quoteStagings: {
        where: { rejectedAt: null },
        select: { id: true },
      },
    },
  });
  if (!candidate) {
    throw new ConvertBidCandidateError("NOT_FOUND", "Bid candidate not found");
  }

  const alreadyConverted = Boolean(
    candidate.lifecycle === "CONVERTED" || candidate.canonicalJobId
  );
  const convertible =
    !alreadyConverted &&
    (CONVERTIBLE_LIFECYCLES as readonly string[]).includes(candidate.lifecycle);

  const suggestedJobNumber = await suggestNextJobNumberForWorkspace(
    input.prisma,
    input.workspaceId
  );

  return {
    candidateId: candidate.id,
    lifecycle: candidate.lifecycle,
    convertible,
    alreadyConverted,
    existingJobId: candidate.canonicalJobId,
    projectName: candidate.proposedProjectName?.trim() || "",
    customerId: candidate.customerId ?? candidate.customer?.id ?? null,
    customerName:
      candidate.customer?.name?.trim() ||
      candidate.proposedCustomerName?.trim() ||
      null,
    suggestedJobNumber,
    startDate: candidate.anticipatedStartAt?.toISOString() ?? null,
    bidDueAt: candidate.proposedBidDueAt?.toISOString() ?? null,
    scopeSummary: jobDescriptionFromCandidateScope({
      proposedScope: candidate.proposedScope,
      proposedScopeDetail: candidate.proposedScopeDetail,
    }),
    notes: candidate.proposedNotes?.trim() || null,
    estimatorUserId: candidate.proposedEstimatorUserId,
    externalProjectNumber: candidate.proposedJobNumber?.trim() || null,
    emailCount: candidate.emails.length,
    quoteCount: candidate.quoteStagings.length,
    carryForward: {
      emails: candidate.emails.length > 0,
      quotes: candidate.quoteStagings.length > 0,
      attachmentsViaEmails: true,
      aliases: true,
      notes: Boolean(candidate.proposedNotes?.trim()),
      scope: Boolean(
        candidate.proposedScope?.trim() || candidate.proposedScopeDetail
      ),
    },
  };
}

/**
 * Atomic Convert to Job. Idempotent when already CONVERTED / canonicalJobId set.
 */
export async function convertBidCandidateToJob(
  input: ConvertBidCandidateInput
): Promise<ConvertBidCandidateResult> {
  const mode = input.mode ?? "create";

  const candidate = await input.prisma.bidCandidate.findFirst({
    where: { id: input.candidateId, workspaceId: input.workspaceId },
    include: {
      emails: { select: { emailMessageId: true, role: true } },
      customer: { select: { id: true, name: true } },
    },
  });

  if (!candidate) {
    throw new ConvertBidCandidateError("NOT_FOUND", "Bid candidate not found");
  }

  if (candidate.lifecycle === "CONVERTED" || candidate.canonicalJobId) {
    const jobId = candidate.canonicalJobId;
    if (!jobId) {
      throw new ConvertBidCandidateError(
        "ALREADY_CONVERTED",
        "Candidate is converted but Job link is missing"
      );
    }
    const job = await input.prisma.job.findFirst({
      where: { id: jobId, workspaceId: input.workspaceId },
      select: { id: true, jobNumber: true, name: true, status: true },
    });
    return {
      candidateId: candidate.id,
      jobId,
      jobNumber: job?.jobNumber ?? null,
      jobName: job?.name ?? candidate.proposedProjectName ?? "",
      jobStatus: job?.status ?? CONVERTED_JOB_STATUS,
      created: false,
      reused: true,
      attachedEmailCount: candidate.emails.length,
      emailConflicts: [],
    };
  }

  if (
    !(CONVERTIBLE_LIFECYCLES as readonly string[]).includes(candidate.lifecycle)
  ) {
    throw new ConvertBidCandidateError(
      "NOT_CONVERTIBLE",
      `Candidates with lifecycle ${candidate.lifecycle} cannot be converted. Reopen to OPEN/QUOTED first.`
    );
  }

  if (candidate.status === "REJECTED") {
    throw new ConvertBidCandidateError(
      "NOT_CONVERTIBLE",
      "Rejected candidates cannot be converted"
    );
  }

  const projectName =
    input.projectName?.trim() || candidate.proposedProjectName?.trim() || "";
  if (!projectName) {
    throw new ConvertBidCandidateError(
      "NAME_REQUIRED",
      "Project name is required to convert to a Job"
    );
  }

  const customerName =
    input.customerName !== undefined
      ? input.customerName
      : candidate.customer?.name ?? candidate.proposedCustomerName;
  const customerId =
    input.customerId !== undefined
      ? input.customerId
      : candidate.customerId;
  const bidDueAt =
    input.bidDueAt !== undefined ? input.bidDueAt : candidate.proposedBidDueAt;
  const startDate =
    input.startDate !== undefined
      ? input.startDate
      : candidate.anticipatedStartAt;
  const estimatorUserId =
    input.estimatorUserId !== undefined
      ? input.estimatorUserId
      : candidate.proposedEstimatorUserId;
  const description = jobDescriptionFromCandidateScope({
    proposedScope: candidate.proposedScope,
    proposedScopeDetail: candidate.proposedScopeDetail,
    ...(input.description !== undefined
      ? { override: input.description }
      : {}),
  });
  const notes =
    input.notes !== undefined
      ? input.notes?.trim() || null
      : candidate.proposedNotes?.trim() || null;
  // External identifier only — never used as ForgeOps Job number.
  const externalRef = candidate.proposedJobNumber?.trim() || null;

  if (mode === "attach") {
    return attachCandidateToExistingJob({
      prisma: input.prisma,
      workspaceId: input.workspaceId,
      userId: input.userId,
      candidate,
      projectName,
      customerName,
      customerId,
      bidDueAt,
      startDate,
      estimatorUserId,
      description,
      notes,
      externalRef,
      existingJobId: input.existingJobId,
      preserveJobFields: input.preserveJobFields === true,
      jobNumber: input.jobNumber,
    });
  }

  const jobNumber = input.jobNumber?.trim() || "";
  if (!jobNumber) {
    throw new ConvertBidCandidateError(
      "JOB_NUMBER_REQUIRED",
      "Job number is required. Refresh the suggested next number and try again."
    );
  }

  // Prefer explicit number-collision code over name-similarity EXISTING_JOB.
  const taken = await input.prisma.job.findFirst({
    where: { workspaceId: input.workspaceId, jobNumber },
    select: { id: true, name: true, jobNumber: true },
  });
  if (taken) {
    throw new ConvertBidCandidateError(
      "JOB_NUMBER_TAKEN",
      `Job number ${jobNumber} is already in use. Refresh the suggested next number.`,
      { existingJobs: [taken] }
    );
  }

  const likely = await findLikelyExistingJobs(input.prisma, input.workspaceId, {
    projectName,
    // Number already validated above — name-only for EXISTING_JOB warning.
  });
  if (likely.length > 0 && !input.confirmCreateDespiteExisting) {
    throw new ConvertBidCandidateError(
      "EXISTING_JOB",
      `Possible existing Job: ${likely
        .map((j) =>
          j.jobNumber ? `${j.jobNumber} — ${j.name}` : j.name
        )
        .join("; ")}`,
      { existingJobs: likely }
    );
  }

  const now = new Date();
  const normalized = normalizeName(projectName);

  return input.prisma.$transaction(async (tx) => {
    // Row lock — prevent two concurrent conversions creating two Jobs.
    await tx.$queryRaw`
      SELECT id FROM "BidCandidate"
      WHERE id = ${candidate.id} AND "workspaceId" = ${input.workspaceId}
      FOR UPDATE
    `;

    const locked = await tx.bidCandidate.findFirst({
      where: { id: candidate.id, workspaceId: input.workspaceId },
      select: {
        id: true,
        lifecycle: true,
        canonicalJobId: true,
        status: true,
      },
    });
    if (!locked) {
      throw new ConvertBidCandidateError("NOT_FOUND", "Bid candidate not found");
    }
    if (locked.lifecycle === "CONVERTED" || locked.canonicalJobId) {
      const jobId = locked.canonicalJobId!;
      const job = await tx.job.findFirst({
        where: { id: jobId },
        select: { id: true, jobNumber: true, name: true, status: true },
      });
      return {
        candidateId: candidate.id,
        jobId,
        jobNumber: job?.jobNumber ?? null,
        jobName: job?.name ?? projectName,
        jobStatus: job?.status ?? CONVERTED_JOB_STATUS,
        created: false,
        reused: true,
        attachedEmailCount: 0,
        emailConflicts: [],
      };
    }
    if (
      !(CONVERTIBLE_LIFECYCLES as readonly string[]).includes(locked.lifecycle)
    ) {
      throw new ConvertBidCandidateError(
        "CONCURRENT_CONVERSION",
        "Candidate is no longer convertible"
      );
    }

    const takenInside = await tx.job.findFirst({
      where: { workspaceId: input.workspaceId, jobNumber },
      select: { id: true, name: true, jobNumber: true },
    });
    if (takenInside) {
      throw new ConvertBidCandidateError(
        "JOB_NUMBER_TAKEN",
        `Job number ${jobNumber} is already in use. Refresh the suggested next number.`,
        { existingJobs: [takenInside] }
      );
    }

    const resolved = await resolveOrCreateBiddingCustomer(tx, {
      workspaceId: input.workspaceId,
      customerId: customerId ?? null,
      customerName: customerName ?? null,
    });

    const job = await tx.job.create({
      data: {
        workspaceId: input.workspaceId,
        name: projectName,
        normalizedName: normalized,
        jobNumber,
        customerId: resolved.customerId,
        status: CONVERTED_JOB_STATUS,
        description,
        notes,
        startDate: startDate ?? null,
        bidDueAt: bidDueAt ?? null,
        estimatorUserId: estimatorUserId ?? null,
        externalRef,
        createdByUserId: input.userId,
      },
      select: { id: true, jobNumber: true, name: true, status: true },
    });

    const aliases = dedupeProjectAliases(
      projectName,
      input.alternateProjectNames ?? []
    );
    if (externalRef && !aliases.includes(externalRef)) {
      aliases.push(externalRef);
    }
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

    const emailIds = await collectBidCandidateImportEmailIds(tx, {
      workspaceId: input.workspaceId,
      candidateId: candidate.id,
      includeAllCandidateEmailLinks: true,
    });
    const associated = await associateBidImportEmails({
      prisma: tx,
      workspaceId: input.workspaceId,
      jobId: job.id,
      userId: input.userId,
      emailMessageIds: emailIds,
      now,
    });

    await tx.jobActivityLog.create({
      data: {
        jobId: job.id,
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        action: "JOB_CREATED",
        newValue: {
          status: CONVERTED_JOB_STATUS,
          source: "bid_candidate_convert",
          bidCandidateId: candidate.id,
          jobNumber,
        } as Prisma.InputJsonValue,
      },
    });

    const claimed = await tx.bidCandidate.updateMany({
      where: {
        id: candidate.id,
        workspaceId: input.workspaceId,
        lifecycle: { in: [...CONVERTIBLE_LIFECYCLES] },
        canonicalJobId: null,
      },
      data: {
        status: "CONFIRMED",
        lifecycle: "CONVERTED",
        canonicalJobId: job.id,
        confirmedAt: now,
        confirmedByUserId: input.userId,
        proposedProjectName: projectName,
        proposedCustomerName: customerName,
        customerId: resolved.customerId,
        proposedBidDueAt: bidDueAt,
        anticipatedStartAt: startDate,
        proposedEstimatorUserId: estimatorUserId,
        proposedNotes: notes,
        proposedScope: description,
        importBlockedReason: "Converted to Job",
      },
    });
    if (claimed.count !== 1) {
      throw new ConvertBidCandidateError(
        "CONCURRENT_CONVERSION",
        "Another conversion claimed this Candidate"
      );
    }

    return {
      candidateId: candidate.id,
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobName: job.name,
      jobStatus: job.status,
      created: true,
      reused: false,
      attachedEmailCount:
        associated.attachedEmailIds.length + associated.skippedUnchanged.length,
      emailConflicts: associated.conflicts,
    };
  });
}

async function attachCandidateToExistingJob(input: {
  prisma: PrismaClient;
  workspaceId: string;
  userId: string;
  candidate: {
    id: string;
    emails: Array<{ emailMessageId: string }>;
  };
  projectName: string;
  customerName: string | null | undefined;
  customerId: string | null | undefined;
  bidDueAt: Date | null | undefined;
  startDate: Date | null | undefined;
  estimatorUserId: string | null | undefined;
  description: string | null;
  notes: string | null;
  externalRef: string | null;
  existingJobId?: string | null | undefined;
  preserveJobFields: boolean;
  jobNumber?: string | null | undefined;
}): Promise<ConvertBidCandidateResult> {
  const existingId = input.existingJobId?.trim();
  if (!existingId) {
    throw new ConvertBidCandidateError(
      "ATTACH_JOB_NOT_FOUND",
      "existingJobId is required to attach"
    );
  }
  const existing = await input.prisma.job.findFirst({
    where: { id: existingId, workspaceId: input.workspaceId },
    select: { id: true, status: true, jobNumber: true, name: true },
  });
  if (!existing) {
    throw new ConvertBidCandidateError(
      "ATTACH_JOB_NOT_FOUND",
      "Existing Job not found"
    );
  }

  const now = new Date();
  return input.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "BidCandidate"
      WHERE id = ${input.candidate.id} AND "workspaceId" = ${input.workspaceId}
      FOR UPDATE
    `;

    const locked = await tx.bidCandidate.findFirst({
      where: { id: input.candidate.id, workspaceId: input.workspaceId },
      select: { lifecycle: true, canonicalJobId: true },
    });
    if (locked?.lifecycle === "CONVERTED" || locked?.canonicalJobId) {
      const jobId = locked.canonicalJobId!;
      const job = await tx.job.findFirst({
        where: { id: jobId },
        select: { id: true, jobNumber: true, name: true, status: true },
      });
      return {
        candidateId: input.candidate.id,
        jobId,
        jobNumber: job?.jobNumber ?? null,
        jobName: job?.name ?? input.projectName,
        jobStatus: job?.status ?? existing.status,
        created: false,
        reused: true,
        attachedEmailCount: 0,
        emailConflicts: [],
      };
    }

    if (!input.preserveJobFields) {
      await tx.job.update({
        where: { id: existing.id },
        data: {
          ...(input.bidDueAt ? { bidDueAt: input.bidDueAt } : {}),
          ...(input.startDate ? { startDate: input.startDate } : {}),
          ...(input.jobNumber?.trim()
            ? { jobNumber: input.jobNumber.trim() }
            : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
        },
      });
    }

    const emailIds = await collectBidCandidateImportEmailIds(tx, {
      workspaceId: input.workspaceId,
      candidateId: input.candidate.id,
      includeAllCandidateEmailLinks: true,
    });
    const associated = await associateBidImportEmails({
      prisma: tx,
      workspaceId: input.workspaceId,
      jobId: existing.id,
      userId: input.userId,
      emailMessageIds: emailIds,
      now,
    });

    const claimed = await tx.bidCandidate.updateMany({
      where: {
        id: input.candidate.id,
        workspaceId: input.workspaceId,
        lifecycle: { in: [...CONVERTIBLE_LIFECYCLES] },
        canonicalJobId: null,
      },
      data: {
        status: "CONFIRMED",
        lifecycle: "CONVERTED",
        canonicalJobId: existing.id,
        confirmedAt: now,
        confirmedByUserId: input.userId,
        proposedProjectName: input.projectName,
        proposedCustomerName: input.customerName ?? null,
        customerId: input.customerId ?? null,
        proposedBidDueAt: input.bidDueAt ?? null,
        anticipatedStartAt: input.startDate ?? null,
        proposedEstimatorUserId: input.estimatorUserId ?? null,
        importBlockedReason: "Converted to Job",
      },
    });
    if (claimed.count !== 1) {
      throw new ConvertBidCandidateError(
        "CONCURRENT_CONVERSION",
        "Another conversion claimed this Candidate"
      );
    }

    // Activity only when not already logged for this conversion (idempotent retries skip create path).
    await tx.jobActivityLog.create({
      data: {
        jobId: existing.id,
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        action: "EMAIL_ASSIGNED",
        newValue: {
          source: "bid_candidate_convert_attach",
          bidCandidateId: input.candidate.id,
          attachedEmailCount:
            associated.attachedEmailIds.length +
            associated.skippedUnchanged.length,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      candidateId: input.candidate.id,
      jobId: existing.id,
      jobNumber: existing.jobNumber,
      jobName: existing.name,
      jobStatus: existing.status,
      created: false,
      reused: false,
      attachedEmailCount:
        associated.attachedEmailIds.length + associated.skippedUnchanged.length,
      emailConflicts: associated.conflicts,
    };
  });
}

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
