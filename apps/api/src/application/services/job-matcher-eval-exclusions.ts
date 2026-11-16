/**
 * Persist Job Matcher evaluation runs and run-specific email exclusions.
 * Exclusions never rewrite raw evaluation outcomes or ground truth.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { JobMatcherHistoricalEvalResult } from "./run-job-matcher-historical-eval.js";
import { AuditEventLogger } from "./audit-event-logger.js";
import type { FastifyRequest } from "fastify";

export type JobMatcherEvalExclusionDto = {
  id: string;
  evaluationRunId: string;
  emailMessageId: string;
  excludedByUserId: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function persistJobMatcherEvalRun(input: {
  prisma: PrismaClient;
  workspaceId: string;
  createdByUserId: string | null;
  result: JobMatcherHistoricalEvalResult;
}): Promise<void> {
  const { prisma, workspaceId, createdByUserId, result } = input;
  const id = result.evaluationRunId;
  if (!id) return;

  await prisma.jobMatcherEvalRun.upsert({
    where: { id },
    create: {
      id,
      workspaceId,
      createdByUserId,
      datasetFingerprint: result.datasetFingerprint ?? null,
      experimentRevision: result.experimentRevision ?? null,
      resultJson: toJson(result),
    },
    update: {
      datasetFingerprint: result.datasetFingerprint ?? null,
      experimentRevision: result.experimentRevision ?? null,
      resultJson: toJson(result),
      updatedAt: new Date(),
    },
  });
}

export async function getJobMatcherEvalRun(input: {
  prisma: PrismaClient;
  workspaceId: string;
  evaluationRunId: string;
}): Promise<{
  evaluation: JobMatcherHistoricalEvalResult;
  exclusions: JobMatcherEvalExclusionDto[];
} | null> {
  const run = await input.prisma.jobMatcherEvalRun.findFirst({
    where: {
      id: input.evaluationRunId,
      workspaceId: input.workspaceId,
    },
    include: {
      exclusions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) return null;
  return {
    evaluation: run.resultJson as unknown as JobMatcherHistoricalEvalResult,
    exclusions: run.exclusions.map(mapExclusion),
  };
}

export async function listJobMatcherEvalExclusions(input: {
  prisma: PrismaClient;
  workspaceId: string;
  evaluationRunId: string;
}): Promise<JobMatcherEvalExclusionDto[]> {
  const rows = await input.prisma.jobMatcherEvalExclusion.findMany({
    where: {
      workspaceId: input.workspaceId,
      evaluationRunId: input.evaluationRunId,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(mapExclusion);
}

export async function excludeJobMatcherEvalEmail(input: {
  prisma: PrismaClient;
  workspaceId: string;
  evaluationRunId: string;
  emailMessageId: string;
  actorUserId: string;
  reason?: string | null;
  request?: FastifyRequest;
}): Promise<JobMatcherEvalExclusionDto> {
  const run = await input.prisma.jobMatcherEvalRun.findFirst({
    where: {
      id: input.evaluationRunId,
      workspaceId: input.workspaceId,
    },
    select: { id: true, resultJson: true },
  });
  if (!run) {
    throw new Error("Evaluation run not found");
  }
  assertEmailInRun(run.resultJson, input.emailMessageId);

  const row = await input.prisma.jobMatcherEvalExclusion.upsert({
    where: {
      evaluationRunId_emailMessageId: {
        evaluationRunId: input.evaluationRunId,
        emailMessageId: input.emailMessageId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      evaluationRunId: input.evaluationRunId,
      emailMessageId: input.emailMessageId,
      excludedByUserId: input.actorUserId,
      reason: input.reason?.trim() || null,
    },
    update: {
      excludedByUserId: input.actorUserId,
      reason: input.reason?.trim() || null,
      updatedAt: new Date(),
    },
  });

  const audit = new AuditEventLogger(input.prisma);
  await audit.log({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    entityType: "JobMatcherEvalExclusion",
    entityId: row.id,
    action: "JOB_MATCHER_EVAL_EMAIL_EXCLUDED",
    metadata: {
      evaluationRunId: input.evaluationRunId,
      emailMessageId: input.emailMessageId,
      reason: row.reason,
    },
    ...(input.request ? { request: input.request } : {}),
  });

  return mapExclusion(row);
}

export async function restoreJobMatcherEvalEmail(input: {
  prisma: PrismaClient;
  workspaceId: string;
  evaluationRunId: string;
  emailMessageId: string;
  actorUserId: string;
  request?: FastifyRequest;
}): Promise<{ restored: boolean }> {
  const existing = await input.prisma.jobMatcherEvalExclusion.findFirst({
    where: {
      workspaceId: input.workspaceId,
      evaluationRunId: input.evaluationRunId,
      emailMessageId: input.emailMessageId,
    },
  });
  if (!existing) return { restored: false };

  await input.prisma.jobMatcherEvalExclusion.delete({
    where: { id: existing.id },
  });

  const audit = new AuditEventLogger(input.prisma);
  await audit.log({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    entityType: "JobMatcherEvalExclusion",
    entityId: existing.id,
    action: "JOB_MATCHER_EVAL_EMAIL_RESTORED",
    metadata: {
      evaluationRunId: input.evaluationRunId,
      emailMessageId: input.emailMessageId,
    },
    ...(input.request ? { request: input.request } : {}),
  });

  return { restored: true };
}

function mapExclusion(row: {
  id: string;
  evaluationRunId: string;
  emailMessageId: string;
  excludedByUserId: string | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): JobMatcherEvalExclusionDto {
  return {
    id: row.id,
    evaluationRunId: row.evaluationRunId,
    emailMessageId: row.emailMessageId,
    excludedByUserId: row.excludedByUserId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertEmailInRun(resultJson: unknown, emailMessageId: string): void {
  const result = resultJson as {
    rows?: Array<{ emailMessageId: string }>;
    policyResults?: Array<{ rows?: Array<{ emailMessageId: string }> }>;
  };
  const ids = new Set<string>();
  for (const r of result.rows ?? []) ids.add(r.emailMessageId);
  for (const bundle of result.policyResults ?? []) {
    for (const r of bundle.rows ?? []) ids.add(r.emailMessageId);
  }
  if (!ids.has(emailMessageId)) {
    throw new Error("Email is not part of this evaluation run");
  }
}
