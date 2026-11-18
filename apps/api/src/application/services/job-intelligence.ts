import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import {
  JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
  JOB_INTELLIGENCE_INCREMENTAL_DEBOUNCE_MS,
  JOB_INTELLIGENCE_SCHEMA_VERSION,
  QueueNames,
  buildJobIntelligenceIncrementalJobId,
  buildJobIntelligenceRunJobId,
  emptyJobIntelligenceProgress,
  type JobIntelligenceJobPayload,
  type JobIntelligenceJobResult,
} from "@forgeops/shared";

type IntelligenceQueue = Queue<
  JobIntelligenceJobPayload,
  JobIntelligenceJobResult
>;

export async function startJobIntelligenceAnalysis(input: {
  prisma: PrismaClient;
  queue: IntelligenceQueue;
  workspaceId: string;
  jobId: string;
  userId: string;
  kind?: "HISTORICAL_BACKFILL" | "INCREMENTAL" | "SUMMARY_ONLY" | "REPROCESS";
}): Promise<{ runId: string; status: string }> {
  const job = await input.prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) {
    throw Object.assign(new Error("Job not found"), { statusCode: 404 });
  }

  const kind = input.kind ?? "HISTORICAL_BACKFILL";
  const active = await input.prisma.jobIntelligenceAnalysisRun.findFirst({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (active && kind === "HISTORICAL_BACKFILL") {
    return { runId: active.id, status: active.status };
  }

  const run = await input.prisma.jobIntelligenceAnalysisRun.create({
    data: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      status: "PENDING",
      kind,
      extractionModelVersion: JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
      schemaVersion: JOB_INTELLIGENCE_SCHEMA_VERSION,
      progress: emptyJobIntelligenceProgress() as object,
      initiatedByUserId: input.userId,
    },
  });

  const jobId =
    kind === "INCREMENTAL"
      ? buildJobIntelligenceIncrementalJobId(input.jobId)
      : buildJobIntelligenceRunJobId(run.id);

  await input.queue.add(
    QueueNames.JOB_INTELLIGENCE,
    {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      runId: run.id,
      kind,
      initiatedByUserId: input.userId,
    },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 40 },
      ...(kind === "INCREMENTAL"
        ? { delay: JOB_INTELLIGENCE_INCREMENTAL_DEBOUNCE_MS }
        : {}),
    }
  );

  return { runId: run.id, status: run.status };
}

export async function getJobIntelligenceBundle(input: {
  prisma: PrismaClient;
  workspaceId: string;
  jobId: string;
  category?: string | null;
}) {
  const job = await input.prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { assignedEmails: true } },
    },
  });
  if (!job) return null;

  const [summary, latestRun, events, emailStateCounts] = await Promise.all([
    input.prisma.jobIntelligenceSummary.findFirst({
      where: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        status: { in: ["CURRENT", "STALE"] },
      },
      orderBy: [{ status: "asc" }, { version: "desc" }],
    }),
    input.prisma.jobIntelligenceAnalysisRun.findFirst({
      where: { workspaceId: input.workspaceId, jobId: input.jobId },
      orderBy: { createdAt: "desc" },
    }),
    input.prisma.jobIntelligenceEvent.findMany({
      where: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        verificationStatus: { not: "REJECTED" },
        ...(input.category
          ? { category: input.category as "FINANCIAL" }
          : {}),
      },
      orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: {
        sources: {
          select: {
            id: true,
            emailMessageId: true,
            emailAttachmentId: true,
            excerpt: true,
            sourceRole: true,
          },
        },
      },
    }),
    input.prisma.jobIntelligenceEmailState.groupBy({
      by: ["status"],
      where: { workspaceId: input.workspaceId, jobId: input.jobId },
      _count: { _all: true },
    }),
  ]);

  return {
    job: {
      id: job.id,
      name: job.name,
      status: job.status,
      emailCount: job._count.assignedEmails,
    },
    summary,
    latestRun,
    events,
    emailStateCounts: Object.fromEntries(
      emailStateCounts.map((r) => [r.status, r._count._all])
    ),
  };
}

export async function verifyJobIntelligenceEvent(input: {
  prisma: PrismaClient;
  workspaceId: string;
  jobId: string;
  eventId: string;
  userId: string;
  action: "verify" | "reject";
}) {
  const event = await input.prisma.jobIntelligenceEvent.findFirst({
    where: {
      id: input.eventId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
  });
  if (!event) {
    throw Object.assign(new Error("Event not found"), { statusCode: 404 });
  }
  const verificationStatus =
    input.action === "verify" ? "HUMAN_VERIFIED" : "REJECTED";
  const updated = await input.prisma.jobIntelligenceEvent.update({
    where: { id: event.id },
    data: {
      verificationStatus,
      verifiedByUserId: input.userId,
      verifiedAt: new Date(),
    },
  });
  await input.prisma.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      entityType: "JOB",
      entityId: input.jobId,
      action:
        input.action === "verify"
          ? "JOB_INTELLIGENCE_EVENT_VERIFIED"
          : "JOB_INTELLIGENCE_EVENT_REJECTED",
      metadata: { eventId: event.id, verificationStatus },
    },
  });
  return updated;
}

export async function correctJobIntelligenceEvent(input: {
  prisma: PrismaClient;
  workspaceId: string;
  jobId: string;
  eventId: string;
  userId: string;
  patch: {
    title?: string;
    description?: string;
    status?: string;
    amount?: number | null;
    financialKind?: string;
    eventDate?: string | null;
  };
}) {
  const event = await input.prisma.jobIntelligenceEvent.findFirst({
    where: {
      id: input.eventId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
  });
  if (!event) {
    throw Object.assign(new Error("Event not found"), { statusCode: 404 });
  }
  const updated = await input.prisma.jobIntelligenceEvent.update({
    where: { id: event.id },
    data: {
      ...(input.patch.title != null ? { title: input.patch.title.slice(0, 240) } : {}),
      ...(input.patch.description != null
        ? { description: input.patch.description.slice(0, 4000) }
        : {}),
      ...(input.patch.status != null
        ? { status: input.patch.status as "UNKNOWN" }
        : {}),
      ...(input.patch.amount !== undefined
        ? { amountDecimal: input.patch.amount }
        : {}),
      ...(input.patch.financialKind != null
        ? { financialKind: input.patch.financialKind as "NONE" }
        : {}),
      ...(input.patch.eventDate !== undefined
        ? {
            eventDate: input.patch.eventDate
              ? new Date(`${input.patch.eventDate}T12:00:00.000Z`)
              : null,
          }
        : {}),
      verificationStatus: "HUMAN_CORRECTED",
      humanCorrection: input.patch as object,
      verifiedByUserId: input.userId,
      verifiedAt: new Date(),
    },
  });
  await input.prisma.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      entityType: "JOB",
      entityId: input.jobId,
      action: "JOB_INTELLIGENCE_EVENT_CORRECTED",
      metadata: { eventId: event.id, patch: input.patch },
    },
  });
  return updated;
}

/**
 * Soft-invalidate intelligence that depended solely on an email moved off a Job.
 * Does not modify EmailMessage assignment (caller already did).
 */
export async function invalidateIntelligenceForEmailReassignment(input: {
  prisma: PrismaClient;
  queue: IntelligenceQueue;
  workspaceId: string;
  emailMessageId: string;
  fromJobId: string | null;
  toJobId: string | null;
  userId: string;
}): Promise<void> {
  if (input.fromJobId) {
    const sources = await input.prisma.jobIntelligenceEventSource.findMany({
      where: {
        workspaceId: input.workspaceId,
        emailMessageId: input.emailMessageId,
        event: { jobId: input.fromJobId },
      },
      select: { eventId: true },
    });
    const eventIds = [...new Set(sources.map((s) => s.eventId))];
    for (const eventId of eventIds) {
      const remaining = await input.prisma.jobIntelligenceEventSource.count({
        where: {
          eventId,
          workspaceId: input.workspaceId,
          OR: [
            { emailMessageId: { not: input.emailMessageId } },
            { emailMessageId: null },
          ],
        },
      });
      if (remaining === 0) {
        await input.prisma.jobIntelligenceEvent.updateMany({
          where: {
            id: eventId,
            workspaceId: input.workspaceId,
            jobId: input.fromJobId,
            verificationStatus: {
              notIn: ["HUMAN_VERIFIED", "HUMAN_CORRECTED"],
            },
          },
          data: { verificationStatus: "SUPERSEDED" },
        });
      }
    }
    await input.prisma.jobIntelligenceEmailState.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        jobId: input.fromJobId,
        emailMessageId: input.emailMessageId,
      },
    });
    await input.prisma.jobIntelligenceSummary.updateMany({
      where: {
        workspaceId: input.workspaceId,
        jobId: input.fromJobId,
        status: "CURRENT",
      },
      data: { status: "STALE" },
    });
    await input.prisma.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        entityType: "JOB",
        entityId: input.fromJobId,
        action: "JOB_INTELLIGENCE_INVALIDATED_REASSIGN",
        metadata: {
          emailMessageId: input.emailMessageId,
          toJobId: input.toJobId,
        },
      },
    });
  }

  if (input.toJobId) {
    const hasIntel = await input.prisma.jobIntelligenceSummary.findFirst({
      where: { workspaceId: input.workspaceId, jobId: input.toJobId },
      select: { id: true },
    });
    if (hasIntel) {
      await startJobIntelligenceAnalysis({
        prisma: input.prisma,
        queue: input.queue,
        workspaceId: input.workspaceId,
        jobId: input.toJobId,
        userId: input.userId,
        kind: "INCREMENTAL",
      });
    }
  }
}
