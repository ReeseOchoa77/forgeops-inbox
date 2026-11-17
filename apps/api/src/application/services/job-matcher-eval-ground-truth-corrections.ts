/**
 * DEPRECATED persistence layer for Job Matcher evaluation ground-truth
 * corrections.
 *
 * The Evaluation UI Mark Correct flow is now temporary / client-side only and
 * must not call these writers. Routes may remain for compatibility; do not use
 * them from the web client.
 *
 * Historical note: this service only ever wrote JobMatcherEvalGroundTruthCorrection
 * rows (+ audit events). It never updates EmailMessage.jobId and never rewrites
 * JobMatcherEvalRun.resultJson.
 */
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { AuditEventLogger } from "./audit-event-logger.js";

export type JobMatcherEvalGroundTruthCorrectionDto = {
  id: string;
  emailMessageId: string;
  originalGroundTruthJobId: string;
  correctedGroundTruthJobId: string;
  correctedJobName: string | null;
  correctedJobNumber: string | null;
  verificationStatus: "ACTIVE" | "REVERSED";
  verifiedAt: string;
  verifiedByUserId: string | null;
  sourceEvaluationRunId: string | null;
  sourceModelPolicy: string | null;
  note: string | null;
  reversedAt: string | null;
  reversedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type CorrectionRow = {
  id: string;
  emailMessageId: string;
  originalGroundTruthJobId: string;
  correctedGroundTruthJobId: string;
  verificationStatus: string;
  verifiedAt: Date;
  verifiedByUserId: string | null;
  sourceEvaluationRunId: string | null;
  sourceModelPolicy: string | null;
  note: string | null;
  reversedAt: Date | null;
  reversedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type EvalRunRowLite = {
  emailMessageId: string;
  trueJobId: string;
  decision: string;
  predictedJobId: string | null;
  predictedJobName?: string | null;
  predictedJobNumber?: string | null;
  identityPolicy?: string;
};

function mapCorrection(
  row: CorrectionRow,
  job?: { name: string; jobNumber: string | null } | null
): JobMatcherEvalGroundTruthCorrectionDto {
  return {
    id: row.id,
    emailMessageId: row.emailMessageId,
    originalGroundTruthJobId: row.originalGroundTruthJobId,
    correctedGroundTruthJobId: row.correctedGroundTruthJobId,
    correctedJobName: job?.name ?? null,
    correctedJobNumber: job?.jobNumber ?? null,
    verificationStatus: row.verificationStatus === "ACTIVE" ? "ACTIVE" : "REVERSED",
    verifiedAt: row.verifiedAt.toISOString(),
    verifiedByUserId: row.verifiedByUserId,
    sourceEvaluationRunId: row.sourceEvaluationRunId,
    sourceModelPolicy: row.sourceModelPolicy,
    note: row.note,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    reversedByUserId: row.reversedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadJobLabels(
  prisma: PrismaClient,
  workspaceId: string,
  jobIds: string[]
): Promise<Map<string, { name: string; jobNumber: string | null }>> {
  const unique = [...new Set(jobIds)];
  if (unique.length === 0) return new Map();
  const jobs = await prisma.job.findMany({
    where: { workspaceId, id: { in: unique } },
    select: { id: true, name: true, jobNumber: true },
  });
  return new Map(jobs.map((j) => [j.id, { name: j.name, jobNumber: j.jobNumber }]));
}

/** ACTIVE corrections for the workspace (optionally limited to email ids). */
export async function listActiveJobMatcherEvalGroundTruthCorrections(input: {
  prisma: PrismaClient;
  workspaceId: string;
  emailMessageIds?: string[];
}): Promise<JobMatcherEvalGroundTruthCorrectionDto[]> {
  if (input.emailMessageIds && input.emailMessageIds.length === 0) return [];
  const rows = await input.prisma.jobMatcherEvalGroundTruthCorrection.findMany({
    where: {
      workspaceId: input.workspaceId,
      verificationStatus: "ACTIVE",
      ...(input.emailMessageIds
        ? { emailMessageId: { in: input.emailMessageIds } }
        : {}),
    },
    orderBy: { verifiedAt: "asc" },
  });
  const labels = await loadJobLabels(
    input.prisma,
    input.workspaceId,
    rows.map((r) => r.correctedGroundTruthJobId)
  );
  return rows.map((r) =>
    mapCorrection(r, labels.get(r.correctedGroundTruthJobId) ?? null)
  );
}

/** Distinct email ids that appear in a persisted evaluation result. */
export function collectEvalRunEmailIds(resultJson: unknown): string[] {
  return [...new Set(collectEvalRunRows(resultJson).map((r) => r.emailMessageId))];
}

function collectEvalRunRows(resultJson: unknown): EvalRunRowLite[] {
  const result = resultJson as {
    rows?: EvalRunRowLite[];
    policyResults?: Array<{ identityPolicy?: string; rows?: EvalRunRowLite[] }>;
  };
  const out: EvalRunRowLite[] = [];
  for (const r of result.rows ?? []) out.push(r);
  for (const bundle of result.policyResults ?? []) {
    for (const r of bundle.rows ?? []) {
      out.push(bundle.identityPolicy ? { identityPolicy: bundle.identityPolicy, ...r } : r);
    }
  }
  return out;
}

export async function verifyJobMatcherEvalGroundTruthCorrection(input: {
  prisma: PrismaClient;
  workspaceId: string;
  evaluationRunId: string;
  emailMessageId: string;
  correctedGroundTruthJobId: string;
  sourceModelPolicy?: string | null;
  note?: string | null;
  actorUserId: string;
  request?: FastifyRequest;
}): Promise<JobMatcherEvalGroundTruthCorrectionDto> {
  const run = await input.prisma.jobMatcherEvalRun.findFirst({
    where: { id: input.evaluationRunId, workspaceId: input.workspaceId },
    select: { id: true, resultJson: true },
  });
  if (!run) throw new Error("Evaluation run not found");

  const emailRows = collectEvalRunRows(run.resultJson).filter(
    (r) => r.emailMessageId === input.emailMessageId
  );
  if (emailRows.length === 0) {
    throw new Error("Email is not part of this evaluation run");
  }

  // Persisted run JSON is never rewritten, so row.trueJobId is the original GT.
  const originalGroundTruthJobId = emailRows[0]!.trueJobId;
  const correctedId = input.correctedGroundTruthJobId;
  if (correctedId === originalGroundTruthJobId) {
    throw new Error("Corrected Job is already the ground truth for this email");
  }

  const supporting = emailRows.find(
    (r) => r.decision === "MATCH" && r.predictedJobId === correctedId
  );
  if (!supporting) {
    throw new Error(
      "Only a model MATCH prediction can be verified as ground truth (Ambiguous / Conflict / No Match cannot)"
    );
  }

  const labels = await loadJobLabels(input.prisma, input.workspaceId, [correctedId]);
  if (!labels.has(correctedId)) {
    throw new Error("Corrected Job not found in workspace");
  }

  const now = new Date();
  const row = await input.prisma.$transaction(async (tx) => {
    await tx.jobMatcherEvalGroundTruthCorrection.updateMany({
      where: {
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        verificationStatus: "ACTIVE",
      },
      data: {
        verificationStatus: "REVERSED",
        reversedAt: now,
        reversedByUserId: input.actorUserId,
      },
    });
    return tx.jobMatcherEvalGroundTruthCorrection.create({
      data: {
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        originalGroundTruthJobId,
        correctedGroundTruthJobId: correctedId,
        verificationStatus: "ACTIVE",
        verifiedAt: now,
        verifiedByUserId: input.actorUserId,
        sourceEvaluationRunId: input.evaluationRunId,
        sourceModelPolicy:
          input.sourceModelPolicy ?? supporting.identityPolicy ?? null,
        note: input.note?.trim() || null,
      },
    });
  });

  const audit = new AuditEventLogger(input.prisma);
  await audit.log({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    entityType: "JobMatcherEvalGroundTruthCorrection",
    entityId: row.id,
    action: "JOB_MATCHER_EVAL_GT_VERIFIED",
    metadata: {
      evaluationRunId: input.evaluationRunId,
      emailMessageId: input.emailMessageId,
      originalGroundTruthJobId,
      correctedGroundTruthJobId: correctedId,
      sourceModelPolicy: row.sourceModelPolicy,
    },
    ...(input.request ? { request: input.request } : {}),
  });

  return mapCorrection(row, labels.get(correctedId) ?? null);
}

export async function reverseJobMatcherEvalGroundTruthCorrection(input: {
  prisma: PrismaClient;
  workspaceId: string;
  emailMessageId: string;
  actorUserId: string;
  request?: FastifyRequest;
}): Promise<{ reversed: boolean }> {
  const active = await input.prisma.jobMatcherEvalGroundTruthCorrection.findMany({
    where: {
      workspaceId: input.workspaceId,
      emailMessageId: input.emailMessageId,
      verificationStatus: "ACTIVE",
    },
  });
  if (active.length === 0) return { reversed: false };

  await input.prisma.jobMatcherEvalGroundTruthCorrection.updateMany({
    where: { id: { in: active.map((a) => a.id) } },
    data: {
      verificationStatus: "REVERSED",
      reversedAt: new Date(),
      reversedByUserId: input.actorUserId,
    },
  });

  const audit = new AuditEventLogger(input.prisma);
  for (const a of active) {
    await audit.log({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: "JobMatcherEvalGroundTruthCorrection",
      entityId: a.id,
      action: "JOB_MATCHER_EVAL_GT_REVERSED",
      metadata: {
        emailMessageId: input.emailMessageId,
        originalGroundTruthJobId: a.originalGroundTruthJobId,
        correctedGroundTruthJobId: a.correctedGroundTruthJobId,
      },
      ...(input.request ? { request: input.request } : {}),
    });
  }
  return { reversed: true };
}
