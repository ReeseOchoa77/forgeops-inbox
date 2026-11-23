import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  OpenAIJobIntelligenceExtractor,
  OpenAIJobIntelligenceSummarizer,
  createOpenAIClient,
} from "@forgeops/ai";
import {
  JOB_INTELLIGENCE_EMAIL_BATCH_SIZE,
  JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
  JOB_INTELLIGENCE_MAX_ATTACHMENT_CHARS,
  JOB_INTELLIGENCE_MAX_BODY_CHARS,
  JOB_INTELLIGENCE_SCHEMA_VERSION,
  JOB_INTELLIGENCE_SUMMARY_MODEL_VERSION,
  classifyJobIntelligenceEligibility,
  emptyJobIntelligenceProgress,
  hashExcerpt,
  isEligibleForAutomaticAggregation,
  isHumanProtectedVerification,
  parseJobIntelligenceProgress,
  planScheduleSupersession,
  prepareEmailBodyForExtraction,
  eligibilitySkipReason,
  type JobIntelligenceJobPayload,
  type JobIntelligenceJobResult,
  type JobIntelligenceRunProgress,
} from "@forgeops/shared";

import { isWorkspaceAiSubsystemEnabled } from "../services/ai-control-gates.js";

type Deps = {
  prisma: PrismaClient;
  openaiApiKey?: string | null;
  openaiModel?: string;
  finalAttempt?: boolean;
};

function contentHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40);
}

async function writeProgress(
  prisma: PrismaClient,
  runId: string,
  progress: JobIntelligenceRunProgress,
  patch?: { status?: string; errorMessage?: string | null; startedAt?: Date; completedAt?: Date }
) {
  await prisma.jobIntelligenceAnalysisRun.update({
    where: { id: runId },
    data: {
      progress: progress as object,
      ...(patch?.status ? { status: patch.status as "RUNNING" } : {}),
      ...(patch?.errorMessage !== undefined
        ? { errorMessage: patch.errorMessage }
        : {}),
      ...(patch?.startedAt ? { startedAt: patch.startedAt } : {}),
      ...(patch?.completedAt ? { completedAt: patch.completedAt } : {}),
    },
  });
}

export async function failOpenJobIntelligenceRun(
  runId: string,
  prisma: PrismaClient,
  errorMessage: string
): Promise<void> {
  try {
    await prisma.jobIntelligenceAnalysisRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        errorMessage: errorMessage.slice(0, 1000),
        completedAt: new Date(),
      },
    });
  } catch {
    // ignore
  }
}

export async function processJobIntelligenceRun(
  payload: JobIntelligenceJobPayload,
  deps: Deps
): Promise<JobIntelligenceJobResult> {
  const { prisma } = deps;
  const run = await prisma.jobIntelligenceAnalysisRun.findFirst({
    where: {
      id: payload.runId,
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
    },
  });
  if (!run) {
    return {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      runId: payload.runId,
      status: "FAILED",
      errorMessage: "Analysis run not found",
    };
  }
  if (run.status === "CANCELLED") {
    return {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      runId: payload.runId,
      status: "CANCELLED",
    };
  }

  const jiEnabled = await isWorkspaceAiSubsystemEnabled(
    prisma,
    payload.workspaceId,
    "job-intelligence"
  );
  if (!jiEnabled) {
    await failOpenJobIntelligenceRun(
      payload.runId,
      prisma,
      "Job Intelligence disabled in AI Control Center (queued run aborted; existing data preserved)"
    );
    return {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      runId: payload.runId,
      status: "FAILED",
      errorMessage: "ai_control_disabled",
    };
  }

  const job = await prisma.job.findFirst({
    where: { id: payload.jobId, workspaceId: payload.workspaceId },
    select: { id: true, name: true },
  });
  if (!job) {
    await failOpenJobIntelligenceRun(payload.runId, prisma, "Job not found");
    return {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      runId: payload.runId,
      status: "FAILED",
      errorMessage: "Job not found",
    };
  }

  const progress = parseJobIntelligenceProgress(run.progress);
  await prisma.jobIntelligenceAnalysisRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      startedAt: run.startedAt ?? new Date(),
      errorMessage: null,
    },
  });

  const client = createOpenAIClient(
    deps.openaiApiKey ? { apiKey: deps.openaiApiKey } : {}
  );
  const extractor = new OpenAIJobIntelligenceExtractor(
    client,
    deps.openaiModel
  );
  const summarizer = new OpenAIJobIntelligenceSummarizer(
    client,
    deps.openaiModel
  );

  const emails = await prisma.emailMessage.findMany({
    where: {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
    },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      subject: true,
      bodyText: true,
      senderEmail: true,
      senderName: true,
      sentAt: true,
      receivedAt: true,
      jobAssignmentSource: true,
      jobAssignmentIsManual: true,
      jobId: true,
      attachments: {
        where: { isInline: false },
        select: {
          id: true,
          filename: true,
          extractedText: true,
          textExtractStatus: true,
        },
        take: 8,
      },
    },
  });

  progress.eligibleTotal = emails.length;
  await writeProgress(prisma, run.id, progress);

  type ExistingLite = {
    id: string;
    category: string;
    subtype: string | null;
    title: string;
    status: string;
    eventDate: Date | null;
    verificationStatus: string;
    contentFingerprint: string;
    supersededByEventId: string | null;
    financialKind: string;
    amount: number | null;
  };
  const existingRows = await prisma.jobIntelligenceEvent.findMany({
    where: {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      verificationStatus: { not: "REJECTED" },
    },
    select: {
      id: true,
      category: true,
      subtype: true,
      title: true,
      status: true,
      eventDate: true,
      verificationStatus: true,
      contentFingerprint: true,
      supersededByEventId: true,
      financialKind: true,
      amountDecimal: true,
    },
  });
  const existingEvents: ExistingLite[] = existingRows.map((row) => ({
    id: row.id,
    category: row.category,
    subtype: row.subtype,
    title: row.title,
    status: row.status,
    eventDate: row.eventDate,
    verificationStatus: row.verificationStatus,
    contentFingerprint: row.contentFingerprint,
    supersededByEventId: row.supersededByEventId,
    financialKind: row.financialKind,
    amount: row.amountDecimal == null ? null : Number(row.amountDecimal),
  }));

  for (let i = 0; i < emails.length; i += JOB_INTELLIGENCE_EMAIL_BATCH_SIZE) {
    const fresh = await prisma.jobIntelligenceAnalysisRun.findUnique({
      where: { id: run.id },
      select: { status: true },
    });
    if (fresh?.status === "CANCELLED") {
      return {
        workspaceId: payload.workspaceId,
        jobId: payload.jobId,
        runId: payload.runId,
        status: "CANCELLED",
      };
    }

    const batch = emails.slice(i, i + JOB_INTELLIGENCE_EMAIL_BATCH_SIZE);
    for (const email of batch) {
      const tier = classifyJobIntelligenceEligibility({
        jobId: email.jobId,
        jobAssignmentSource: email.jobAssignmentSource,
        jobAssignmentIsManual: email.jobAssignmentIsManual,
      });

      if (!isEligibleForAutomaticAggregation(tier)) {
        progress.skipped += 1;
        if (tier === "REVIEW_ONLY") progress.reviewOnly += 1;
        await prisma.jobIntelligenceEmailState.upsert({
          where: {
            workspaceId_jobId_emailMessageId: {
              workspaceId: payload.workspaceId,
              jobId: payload.jobId,
              emailMessageId: email.id,
            },
          },
          create: {
            workspaceId: payload.workspaceId,
            jobId: payload.jobId,
            emailMessageId: email.id,
            eligibilityTier: tier,
            status: "SKIPPED",
            skipReason: eligibilitySkipReason(tier),
            lastRunId: run.id,
            lastProcessedAt: new Date(),
          },
          update: {
            eligibilityTier: tier,
            status: "SKIPPED",
            skipReason: eligibilitySkipReason(tier),
            lastRunId: run.id,
            lastProcessedAt: new Date(),
          },
        });
        progress.lastEmailId = email.id;
        continue;
      }

      const prepared = prepareEmailBodyForExtraction(email.bodyText);
      const currentText = prepared.currentText.slice(
        0,
        JOB_INTELLIGENCE_MAX_BODY_CHARS
      );
      const attachmentTexts = email.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        extractedText: (a.extractedText ?? "").slice(
          0,
          JOB_INTELLIGENCE_MAX_ATTACHMENT_CHARS
        ),
      }));
      const hash = contentHash([
        currentText,
        ...attachmentTexts.map((a) => a.extractedText ?? ""),
        JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
      ]);

      const priorState = await prisma.jobIntelligenceEmailState.findUnique({
        where: {
          workspaceId_jobId_emailMessageId: {
            workspaceId: payload.workspaceId,
            jobId: payload.jobId,
            emailMessageId: email.id,
          },
        },
      });
      if (
        priorState?.status === "PROCESSED" &&
        priorState.lastContentHash === hash &&
        priorState.lastExtractionModelVersion ===
          JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION &&
        run.kind === "INCREMENTAL"
      ) {
        progress.skipped += 1;
        progress.lastEmailId = email.id;
        continue;
      }

      try {
        if (!extractor.isConfigured()) {
          throw new Error("OpenAI not configured for Job Intelligence");
        }
        const extraction = await extractor.extract({
          emailId: email.id,
          subject: email.subject ?? "",
          currentBody: currentText,
          senderEmail: email.senderEmail,
          senderName: email.senderName,
          sentAt:
            email.sentAt?.toISOString() ??
            email.receivedAt?.toISOString() ??
            null,
          attachments: attachmentTexts,
        });

        for (const ev of extraction.events) {
          const protectedRow = existingEvents.find(
            (e) =>
              e.contentFingerprint === ev.contentFingerprint &&
              isHumanProtectedVerification(e.verificationStatus)
          );
          if (protectedRow) {
            continue;
          }

          const supersession = planScheduleSupersession(ev, existingEvents);
          const eventDate = ev.eventDate
            ? new Date(`${ev.eventDate}T12:00:00.000Z`)
            : null;

          const upserted = await prisma.jobIntelligenceEvent.upsert({
            where: {
              workspaceId_jobId_contentFingerprint: {
                workspaceId: payload.workspaceId,
                jobId: payload.jobId,
                contentFingerprint: ev.contentFingerprint,
              },
            },
            create: {
              workspaceId: payload.workspaceId,
              jobId: payload.jobId,
              analysisRunId: run.id,
              category: ev.category,
              subtype: ev.subtype,
              title: ev.title,
              description: ev.description,
              eventDate,
              eventDatePrecision: ev.eventDatePrecision,
              status: ev.status,
              confidence: ev.confidence,
              financialKind: ev.financialKind,
              amountDecimal: ev.amount,
              currency: ev.currency,
              parties: ev.parties,
              fabricationItems: ev.fabricationItems,
              ...(supersession
                ? {
                    metadata: {
                      supersedesEventId: supersession.previousEventId,
                    },
                  }
                : {}),
              contentFingerprint: ev.contentFingerprint,
              extractionModelVersion: JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
              schemaVersion: JOB_INTELLIGENCE_SCHEMA_VERSION,
              verificationStatus: "AI_EXTRACTED",
            },
            update: {
              analysisRunId: run.id,
              title: ev.title,
              description: ev.description,
              eventDate,
              eventDatePrecision: ev.eventDatePrecision,
              status: ev.status,
              confidence: ev.confidence,
              financialKind: ev.financialKind,
              amountDecimal: ev.amount,
              currency: ev.currency,
              parties: ev.parties,
              fabricationItems: ev.fabricationItems,
              extractionModelVersion: JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
              schemaVersion: JOB_INTELLIGENCE_SCHEMA_VERSION,
            },
          });

          if (supersession) {
            await prisma.jobIntelligenceEvent.updateMany({
              where: {
                id: supersession.previousEventId,
                workspaceId: payload.workspaceId,
                jobId: payload.jobId,
                verificationStatus: {
                  notIn: ["HUMAN_VERIFIED", "HUMAN_CORRECTED", "REJECTED"],
                },
              },
              data: {
                status: "SUPERSEDED",
                supersededByEventId: upserted.id,
              },
            });
          }

          for (const evidence of ev.evidence) {
            const excerptHash = hashExcerpt(evidence.excerpt);
            await prisma.jobIntelligenceEventSource.upsert({
              where: {
                workspaceId_eventId_emailMessageId_excerptHash: {
                  workspaceId: payload.workspaceId,
                  eventId: upserted.id,
                  emailMessageId: evidence.sourceEmailId,
                  excerptHash,
                },
              },
              create: {
                workspaceId: payload.workspaceId,
                eventId: upserted.id,
                emailMessageId: evidence.sourceEmailId,
                emailAttachmentId: evidence.sourceAttachmentId,
                excerpt: evidence.excerpt,
                excerptHash,
                sourceRole: evidence.sourceRole,
              },
              update: {
                excerpt: evidence.excerpt,
                emailAttachmentId: evidence.sourceAttachmentId,
                sourceRole: evidence.sourceRole,
              },
            });
          }

          const idx = existingEvents.findIndex(
            (e) => e.contentFingerprint === ev.contentFingerprint
          );
          if (idx >= 0) {
            existingEvents[idx] = {
              ...existingEvents[idx]!,
              id: upserted.id,
              title: ev.title,
              status: ev.status,
              eventDate,
              financialKind: ev.financialKind,
              amount: ev.amount,
            };
          } else {
            existingEvents.push({
              id: upserted.id,
              category: ev.category,
              subtype: ev.subtype,
              title: ev.title,
              status: ev.status,
              eventDate,
              verificationStatus: "AI_EXTRACTED",
              contentFingerprint: ev.contentFingerprint,
              supersededByEventId: null,
              financialKind: ev.financialKind,
              amount: ev.amount,
            });
            progress.eventsExtracted += 1;
          }
        }

        await prisma.jobIntelligenceEmailState.upsert({
          where: {
            workspaceId_jobId_emailMessageId: {
              workspaceId: payload.workspaceId,
              jobId: payload.jobId,
              emailMessageId: email.id,
            },
          },
          create: {
            workspaceId: payload.workspaceId,
            jobId: payload.jobId,
            emailMessageId: email.id,
            eligibilityTier: tier,
            status: "PROCESSED",
            lastContentHash: hash,
            lastExtractionModelVersion:
              JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
            lastRunId: run.id,
            lastProcessedAt: new Date(),
          },
          update: {
            eligibilityTier: tier,
            status: "PROCESSED",
            lastContentHash: hash,
            lastExtractionModelVersion:
              JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
            lastRunId: run.id,
            lastProcessedAt: new Date(),
            skipReason: null,
          },
        });
        progress.processed += 1;
      } catch (err) {
        progress.failed += 1;
        const message =
          err instanceof Error ? err.message.slice(0, 400) : "extraction_failed";
        progress.errors.push({ emailMessageId: email.id, message });
        await prisma.jobIntelligenceEmailState.upsert({
          where: {
            workspaceId_jobId_emailMessageId: {
              workspaceId: payload.workspaceId,
              jobId: payload.jobId,
              emailMessageId: email.id,
            },
          },
          create: {
            workspaceId: payload.workspaceId,
            jobId: payload.jobId,
            emailMessageId: email.id,
            eligibilityTier: tier,
            status: "FAILED",
            skipReason: message,
            lastRunId: run.id,
            lastProcessedAt: new Date(),
          },
          update: {
            status: "FAILED",
            skipReason: message,
            lastRunId: run.id,
            lastProcessedAt: new Date(),
          },
        });
      }

      progress.lastEmailId = email.id;
    }
    await writeProgress(prisma, run.id, progress);
  }

  // Summary from structured events (not raw emails)
  const eventsForSummary = await prisma.jobIntelligenceEvent.findMany({
    where: {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      verificationStatus: { not: "REJECTED" },
      supersededByEventId: null,
    },
    orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      category: true,
      subtype: true,
      title: true,
      description: true,
      status: true,
      financialKind: true,
      amountDecimal: true,
      currency: true,
      eventDate: true,
      verificationStatus: true,
    },
  });

  const sections = await summarizer.summarize({
    jobName: job.name,
    events: eventsForSummary.map((e) => ({
      ...e,
      amount: e.amountDecimal == null ? null : Number(e.amountDecimal),
      eventDate: e.eventDate?.toISOString() ?? null,
    })),
  });

  const latest = await prisma.jobIntelligenceSummary.findFirst({
    where: { workspaceId: payload.workspaceId, jobId: payload.jobId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;
  await prisma.jobIntelligenceSummary.updateMany({
    where: {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      status: "CURRENT",
    },
    data: { status: "STALE" },
  });
  await prisma.jobIntelligenceSummary.create({
    data: {
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      version: nextVersion,
      status: "CURRENT",
      sections: sections as object,
      modelVersion: JOB_INTELLIGENCE_SUMMARY_MODEL_VERSION,
      schemaVersion: JOB_INTELLIGENCE_SCHEMA_VERSION,
      generatedAt: new Date(),
      basedOnEventCount: eventsForSummary.length,
      basedOnRunId: run.id,
    },
  });

  await writeProgress(prisma, run.id, progress, {
    status: "COMPLETED",
    completedAt: new Date(),
    errorMessage: null,
  });
  await prisma.jobIntelligenceAnalysisRun.update({
    where: { id: run.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  return {
    workspaceId: payload.workspaceId,
    jobId: payload.jobId,
    runId: payload.runId,
    status: "COMPLETED",
  };
}
