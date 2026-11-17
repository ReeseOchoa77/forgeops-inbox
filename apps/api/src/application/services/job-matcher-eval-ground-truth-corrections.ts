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

export type GroundTruthRestorationScope =
  | "CURRENT_EVALUATION"
  | "TENANT_ALL";

export type GroundTruthRestorationPreviewItem = {
  id: string;
  emailMessageId: string;
  originalGroundTruthJobId: string;
  originalGroundTruthJobLabel: string | null;
  correctedGroundTruthJobId: string;
  correctedGroundTruthJobLabel: string | null;
  verificationStatus: "ACTIVE" | "REVERSED";
  sourceEvaluationRunId: string | null;
  sourceModelPolicy: string | null;
  verifiedAt: string;
};

export type GroundTruthRestorationPreview = {
  scope: GroundTruthRestorationScope;
  evaluationRunId: string | null;
  activeCount: number;
  reversedCount: number;
  affectedEmailCount: number;
  affectedEvaluationRunCount: number;
  restorationNecessary: boolean;
  message: string;
  /** ACTIVE rows that would be reversed (capped for UI). */
  items: GroundTruthRestorationPreviewItem[];
  truncated: boolean;
};

const PREVIEW_ITEM_LIMIT = 50;

function jobLabel(
  job: { name: string; jobNumber: string | null } | null | undefined,
  jobId: string
): string {
  if (!job) return jobId;
  return [job.jobNumber, job.name].filter(Boolean).join(" · ") || jobId;
}

/**
 * Read-only preview of ACTIVE correction overlays that administrative restore
 * would reverse. Never mutates data.
 */
export async function previewJobMatcherEvalGroundTruthRestoration(input: {
  prisma: PrismaClient;
  workspaceId: string;
  scope: GroundTruthRestorationScope;
  evaluationRunId?: string | null;
}): Promise<GroundTruthRestorationPreview> {
  const evaluationRunId = input.evaluationRunId?.trim() || null;
  if (input.scope === "CURRENT_EVALUATION" && !evaluationRunId) {
    throw new Error("evaluationRunId is required for CURRENT_EVALUATION scope");
  }

  let emailIdsInRun: string[] | null = null;
  if (input.scope === "CURRENT_EVALUATION" && evaluationRunId) {
    const run = await input.prisma.jobMatcherEvalRun.findFirst({
      where: { id: evaluationRunId, workspaceId: input.workspaceId },
      select: { resultJson: true },
    });
    if (!run) throw new Error("Evaluation run not found");
    emailIdsInRun = collectEvalRunEmailIds(run.resultJson);
  }

  const workspaceWhere = { workspaceId: input.workspaceId };
  const activeScopeWhere =
    input.scope === "TENANT_ALL"
      ? workspaceWhere
      : {
          ...workspaceWhere,
          OR: [
            { sourceEvaluationRunId: evaluationRunId },
            ...(emailIdsInRun && emailIdsInRun.length > 0
              ? [{ emailMessageId: { in: emailIdsInRun } }]
              : []),
          ],
        };

  const [activeCount, reversedCount, activeRows] = await Promise.all([
    input.prisma.jobMatcherEvalGroundTruthCorrection.count({
      where: { ...activeScopeWhere, verificationStatus: "ACTIVE" },
    }),
    input.prisma.jobMatcherEvalGroundTruthCorrection.count({
      where: { ...activeScopeWhere, verificationStatus: "REVERSED" },
    }),
    input.prisma.jobMatcherEvalGroundTruthCorrection.findMany({
      where: { ...activeScopeWhere, verificationStatus: "ACTIVE" },
      orderBy: { verifiedAt: "asc" },
      take: PREVIEW_ITEM_LIMIT,
    }),
  ]);

  const labels = await loadJobLabels(input.prisma, input.workspaceId, [
    ...activeRows.map((r) => r.originalGroundTruthJobId),
    ...activeRows.map((r) => r.correctedGroundTruthJobId),
  ]);

  const emailSet = new Set(activeRows.map((r) => r.emailMessageId));
  // For full counts when truncated, re-query distinct if needed.
  let affectedEmailCount = emailSet.size;
  let affectedEvaluationRunCount = new Set(
    activeRows.map((r) => r.sourceEvaluationRunId).filter(Boolean)
  ).size;
  const truncated = activeCount > activeRows.length;
  if (truncated || activeCount > 0) {
    const allActive = truncated
      ? await input.prisma.jobMatcherEvalGroundTruthCorrection.findMany({
          where: { ...activeScopeWhere, verificationStatus: "ACTIVE" },
          select: {
            emailMessageId: true,
            sourceEvaluationRunId: true,
          },
        })
      : activeRows.map((r) => ({
          emailMessageId: r.emailMessageId,
          sourceEvaluationRunId: r.sourceEvaluationRunId,
        }));
    affectedEmailCount = new Set(allActive.map((r) => r.emailMessageId)).size;
    affectedEvaluationRunCount = new Set(
      allActive.map((r) => r.sourceEvaluationRunId).filter(Boolean)
    ).size;
  }

  const restorationNecessary = activeCount > 0;
  const message = restorationNecessary
    ? `Found ${activeCount} ACTIVE correction overlay${activeCount === 1 ? "" : "s"} affecting ${affectedEmailCount} email${affectedEmailCount === 1 ? "" : "s"}. Restoration will mark them REVERSED without changing historical evaluation snapshots or production assignments.`
    : "No ACTIVE correction overlays in this scope. Original evaluation data is already in effect; restoration is not necessary.";

  return {
    scope: input.scope,
    evaluationRunId,
    activeCount,
    reversedCount,
    affectedEmailCount,
    affectedEvaluationRunCount,
    restorationNecessary,
    message,
    items: activeRows.map((r) => ({
      id: r.id,
      emailMessageId: r.emailMessageId,
      originalGroundTruthJobId: r.originalGroundTruthJobId,
      originalGroundTruthJobLabel: jobLabel(
        labels.get(r.originalGroundTruthJobId),
        r.originalGroundTruthJobId
      ),
      correctedGroundTruthJobId: r.correctedGroundTruthJobId,
      correctedGroundTruthJobLabel: jobLabel(
        labels.get(r.correctedGroundTruthJobId),
        r.correctedGroundTruthJobId
      ),
      verificationStatus: "ACTIVE",
      sourceEvaluationRunId: r.sourceEvaluationRunId,
      sourceModelPolicy: r.sourceModelPolicy,
      verifiedAt: r.verifiedAt.toISOString(),
    })),
    truncated,
  };
}

/**
 * Admin restore: reverse ACTIVE correction overlays for the given scope.
 * Non-destructive (ACTIVE → REVERSED). Idempotent. Never touches EmailMessage,
 * Jobs, or JobMatcherEvalRun.resultJson.
 */
export async function restoreJobMatcherEvalGroundTruthCorrections(input: {
  prisma: PrismaClient;
  workspaceId: string;
  scope: GroundTruthRestorationScope;
  evaluationRunId?: string | null;
  actorUserId: string;
  confirm: true;
  request?: FastifyRequest;
}): Promise<{
  reversedCount: number;
  affectedEmailCount: number;
  alreadyClean: boolean;
}> {
  if (input.confirm !== true) {
    throw new Error("Explicit confirmation is required");
  }

  const preview = await previewJobMatcherEvalGroundTruthRestoration({
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    scope: input.scope,
    evaluationRunId: input.evaluationRunId ?? null,
  });

  if (!preview.restorationNecessary) {
    return {
      reversedCount: 0,
      affectedEmailCount: 0,
      alreadyClean: true,
    };
  }

  // Re-resolve ACTIVE ids inside a transaction for idempotency under concurrency.
  const evaluationRunId = input.evaluationRunId?.trim() || null;
  let emailIdsInRun: string[] | null = null;
  if (input.scope === "CURRENT_EVALUATION" && evaluationRunId) {
    const run = await input.prisma.jobMatcherEvalRun.findFirst({
      where: { id: evaluationRunId, workspaceId: input.workspaceId },
      select: { resultJson: true },
    });
    if (!run) throw new Error("Evaluation run not found");
    emailIdsInRun = collectEvalRunEmailIds(run.resultJson);
  }

  const activeScopeWhere =
    input.scope === "TENANT_ALL"
      ? { workspaceId: input.workspaceId, verificationStatus: "ACTIVE" as const }
      : {
          workspaceId: input.workspaceId,
          verificationStatus: "ACTIVE" as const,
          OR: [
            { sourceEvaluationRunId: evaluationRunId },
            ...(emailIdsInRun && emailIdsInRun.length > 0
              ? [{ emailMessageId: { in: emailIdsInRun } }]
              : []),
          ],
        };

  const now = new Date();
  const result = await input.prisma.$transaction(async (tx) => {
    const active = await tx.jobMatcherEvalGroundTruthCorrection.findMany({
      where: activeScopeWhere,
      select: {
        id: true,
        emailMessageId: true,
        originalGroundTruthJobId: true,
        correctedGroundTruthJobId: true,
        sourceEvaluationRunId: true,
      },
    });
    if (active.length === 0) {
      return { reversedCount: 0, affectedEmailCount: 0, rows: [] as typeof active };
    }
    await tx.jobMatcherEvalGroundTruthCorrection.updateMany({
      where: { id: { in: active.map((a) => a.id) } },
      data: {
        verificationStatus: "REVERSED",
        reversedAt: now,
        reversedByUserId: input.actorUserId,
      },
    });
    return {
      reversedCount: active.length,
      affectedEmailCount: new Set(active.map((a) => a.emailMessageId)).size,
      rows: active,
    };
  });

  const audit = new AuditEventLogger(input.prisma);
  await audit.log({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    entityType: "JobMatcherEvalGroundTruthCorrection",
    entityId: input.workspaceId,
    action: "JOB_MATCHER_EVAL_GT_RESTORED",
    metadata: {
      scope: input.scope,
      evaluationRunId,
      reversedCount: result.reversedCount,
      affectedEmailCount: result.affectedEmailCount,
      correctionIds: result.rows.map((r) => r.id).slice(0, 100),
    },
    ...(input.request ? { request: input.request } : {}),
  });
  for (const row of result.rows.slice(0, 100)) {
    await audit.log({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: "JobMatcherEvalGroundTruthCorrection",
      entityId: row.id,
      action: "JOB_MATCHER_EVAL_GT_REVERSED",
      metadata: {
        emailMessageId: row.emailMessageId,
        originalGroundTruthJobId: row.originalGroundTruthJobId,
        correctedGroundTruthJobId: row.correctedGroundTruthJobId,
        sourceEvaluationRunId: row.sourceEvaluationRunId,
        via: "admin_restore",
      },
      ...(input.request ? { request: input.request } : {}),
    });
  }

  return {
    reversedCount: result.reversedCount,
    affectedEmailCount: result.affectedEmailCount,
    alreadyClean: result.reversedCount === 0,
  };
}
