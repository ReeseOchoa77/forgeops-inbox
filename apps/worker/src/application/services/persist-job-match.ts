import { Prisma } from "@prisma/client";
import type { JobMatchEvidence, JobMatchResult } from "@forgeops/shared";

export function isManualJobAssignment(existing: {
  jobAssignmentIsManual?: boolean | null;
  jobAssignmentSource?: string | null;
}): boolean {
  return Boolean(
    existing.jobAssignmentIsManual ||
      existing.jobAssignmentSource === "USER_ASSIGNED"
  );
}

export function toJobMatchEvidenceJson(
  evidence: JobMatchEvidence[]
): Prisma.InputJsonValue {
  return evidence.map((e) => ({
    type: e.type,
    value: e.value,
    confidence: e.confidence,
  })) as unknown as Prisma.InputJsonValue;
}

export type JobMatchPersistenceFields = {
  classification: {
    jobId: string | null;
    entityMatchConfidence: Prisma.Decimal | null;
    matchEvidence: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  };
  emailMessage: {
    jobId: string | null;
    jobMatchConfidence: number | null;
    jobMatchEvidence: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    jobAssignmentSource:
      | "AI_AUTO_ASSIGNED"
      | "AI_SUGGESTED"
      | "JOB_NUMBER_MATCH"
      | null;
  };
};

/**
 * Build dual-persistence payloads from a JobMatcherService result.
 * Returns null when a manual assignment must be preserved (caller skips overwrite).
 */
export function buildJobMatchPersistence(
  match: JobMatchResult,
  existing?: {
    jobId?: string | null;
    jobAssignmentIsManual?: boolean | null;
    jobAssignmentSource?: string | null;
  } | null
): JobMatchPersistenceFields | null {
  if (existing && isManualJobAssignment(existing)) {
    return null;
  }

  const evidenceJson =
    match.evidence.length > 0
      ? toJobMatchEvidenceJson(match.evidence)
      : Prisma.JsonNull;

  const classificationConfidence =
    match.confidence > 0
      ? new Prisma.Decimal(match.confidence.toFixed(4))
      : null;

  const emailConfidence =
    match.confidence > 0 ? Number(match.confidence.toFixed(4)) : null;

  return {
    classification: {
      jobId: match.selectedJobId,
      entityMatchConfidence: classificationConfidence,
      matchEvidence: evidenceJson,
    },
    emailMessage: {
      jobId: match.selectedJobId,
      jobMatchConfidence: emailConfidence,
      jobMatchEvidence: evidenceJson,
      jobAssignmentSource: match.assignmentSource,
    },
  };
}

/**
 * Apply JobMatcher result to Classification + EmailMessage in one place.
 * No-ops when manual assignment is protected.
 */
export async function persistJobMatchResult(
  tx: {
    classification: {
      update: (args: {
        where: { id: string };
        data: JobMatchPersistenceFields["classification"];
      }) => Promise<unknown>;
    };
    emailMessage: {
      update: (args: {
        where: { id: string };
        data: JobMatchPersistenceFields["emailMessage"];
      }) => Promise<unknown>;
    };
  },
  input: {
    classificationId: string;
    emailMessageId: string;
    match: JobMatchResult;
    existing?: {
      jobId?: string | null;
      jobAssignmentIsManual?: boolean | null;
      jobAssignmentSource?: string | null;
    } | null;
  }
): Promise<{ applied: boolean; preservedManual: boolean }> {
  const fields = buildJobMatchPersistence(input.match, input.existing);
  if (!fields) {
    return { applied: false, preservedManual: true };
  }

  await Promise.all([
    tx.classification.update({
      where: { id: input.classificationId },
      data: fields.classification,
    }),
    tx.emailMessage.update({
      where: { id: input.emailMessageId },
      data: fields.emailMessage,
    }),
  ]);

  return { applied: true, preservedManual: false };
}
