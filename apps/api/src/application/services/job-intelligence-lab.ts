/**
 * Job Intelligence Lab — isolated experimental runs.
 * Never mutates EmailMessage.jobId or production JobIntelligence* tables.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  OpenAIJobIntelligenceExtractor,
  OpenAIJobIntelligenceSummarizer,
  createOpenAIClient,
} from "@forgeops/ai";
import {
  JobMatcherService,
  JOB_INTELLIGENCE_MAX_ATTACHMENT_CHARS,
  JOB_INTELLIGENCE_MAX_BODY_CHARS,
  classifyJobIntelligenceEligibility,
  compareJobIntelligenceLabRuns,
  createJobMatchEvalLoaderFromSnapshot,
  getProductionJobIntelligenceModelId,
  getProductionJobMatchIdentityPolicy,
  isEligibleForAutomaticAggregation,
  isJobIntelligenceExecutableModelId,
  isJobMatchRunnablePolicyId,
  listExecutableJobIntelligenceModels,
  listEvaluationSelectablePolicies,
  mergeAiControlStates,
  prepareEmailBodyForExtraction,
  resolveJobIntelligenceModelForExecution,
  type JobIntelligenceLabAssociationMode,
  type LabAssociationSnapshotEntry,
  type LabExtractedEventLite,
  type LabRunCompareInput,
} from "@forgeops/shared";

import { loadJobMatchEvalSnapshot } from "./job-match-eval-read.js";

const LAB_MAX_EMAILS = 40;

export async function getWorkspaceIntelligenceConfig(
  prisma: PrismaClient,
  workspaceId: string
) {
  const row = await prisma.workspaceIntelligenceConfig.findUnique({
    where: { workspaceId },
  });
  const productionIntelligenceModelId =
    row?.productionIntelligenceModelId &&
    isJobIntelligenceExecutableModelId(row.productionIntelligenceModelId)
      ? row.productionIntelligenceModelId
      : getProductionJobIntelligenceModelId();

  return {
    productionIntelligenceModelId,
    /** Read-only display of registry production matcher — not silently applied. */
    productionMatcherPolicyId: getProductionJobMatchIdentityPolicy(),
    documentedMatcherPolicyId: row?.documentedMatcherPolicyId ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedByUserId: row?.updatedByUserId ?? null,
    intelligenceModels: listExecutableJobIntelligenceModels(),
    matcherModels: listEvaluationSelectablePolicies().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      description: p.description,
      productionDefault: p.productionDefault,
      experimental: p.experimental,
      retired: p.retired ?? false,
    })),
  };
}

/**
 * Promote / set production Job Intelligence model only.
 * Does NOT change Job Matcher production policy.
 */
export async function setProductionIntelligenceModel(input: {
  prisma: PrismaClient;
  workspaceId: string;
  userId: string;
  intelligenceModelId: string;
  confirm: boolean;
}) {
  if (!input.confirm) {
    throw Object.assign(new Error("Confirmation required to change production intelligence model"), {
      statusCode: 400,
    });
  }
  if (!isJobIntelligenceExecutableModelId(input.intelligenceModelId)) {
    throw Object.assign(
      new Error("Intelligence model is not executable or is retired"),
      { statusCode: 400 }
    );
  }
  const row = await input.prisma.workspaceIntelligenceConfig.upsert({
    where: { workspaceId: input.workspaceId },
    create: {
      workspaceId: input.workspaceId,
      productionIntelligenceModelId: input.intelligenceModelId,
      updatedByUserId: input.userId,
    },
    update: {
      productionIntelligenceModelId: input.intelligenceModelId,
      updatedByUserId: input.userId,
    },
  });

  // Keep AI Control Center in sync for the same production intelligence model.
  const existingAi = await input.prisma.workspaceAiControlConfig.findUnique({
    where: { workspaceId: input.workspaceId },
  });
  const nextSubsystems = mergeAiControlStates(existingAi?.subsystems ?? {});
  nextSubsystems["job-intelligence"] = {
    ...nextSubsystems["job-intelligence"],
    productionModelId: input.intelligenceModelId,
  };
  await input.prisma.workspaceAiControlConfig.upsert({
    where: { workspaceId: input.workspaceId },
    create: {
      workspaceId: input.workspaceId,
      configVersion: 1,
      subsystems: nextSubsystems as object,
      updatedByUserId: input.userId,
    },
    update: {
      configVersion: { increment: 1 },
      subsystems: nextSubsystems as object,
      updatedByUserId: input.userId,
    },
  });

  await input.prisma.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      entityType: "JOB",
      entityId: input.workspaceId,
      action: "JOB_INTELLIGENCE_PRODUCTION_MODEL_SET",
      metadata: {
        productionIntelligenceModelId: input.intelligenceModelId,
        note: "Does not rewrite historical analyses or Job Matcher production policy",
      },
    },
  });
  return row;
}

function configHash(parts: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 24);
}

function isAuthoritativeAssignment(email: {
  jobAssignmentIsManual: boolean | null;
  jobAssignmentSource: string | null;
}): boolean {
  if (email.jobAssignmentIsManual) return true;
  const s = email.jobAssignmentSource;
  return (
    s === "USER_ASSIGNED" ||
    s === "VERIFIED_PROJECT_FOLDER" ||
    s === "FOLDER_ALIAS"
  );
}

export async function runJobIntelligenceLab(input: {
  prisma: PrismaClient;
  workspaceId: string;
  userId: string;
  jobId: string;
  associationMode: JobIntelligenceLabAssociationMode;
  matcherModelId?: string | null;
  intelligenceModelId?: string | null;
  openaiApiKey?: string | null;
  openaiModel?: string;
}): Promise<{ runId: string; status: string }> {
  const job = await input.prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true, name: true },
  });
  if (!job) {
    throw Object.assign(new Error("Job not found"), { statusCode: 404 });
  }

  const intelModel = resolveJobIntelligenceModelForExecution(
    input.intelligenceModelId
  );

  let matcherModelId = "PRODUCTION_ASSIGNMENTS";
  let matcherModelVersion: string | null = null;
  if (input.associationMode === "MATCHER_POLICY") {
    const mid =
      input.matcherModelId?.trim() || getProductionJobMatchIdentityPolicy();
    if (!isJobMatchRunnablePolicyId(mid)) {
      throw Object.assign(
        new Error(
          `Matcher model ${mid} is retired or unknown and cannot be selected for new Lab runs`
        ),
        { statusCode: 400 }
      );
    }
    matcherModelId = mid;
    matcherModelVersion = mid;
  }

  const hash = configHash({
    jobId: input.jobId,
    associationMode: input.associationMode,
    matcherModelId,
    intelligenceModelId: intelModel.id,
    extraction: intelModel.extractionModelVersion,
    schema: intelModel.schemaVersion,
  });

  const run = await input.prisma.jobIntelligenceLabRun.create({
    data: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      status: "RUNNING",
      associationMode: input.associationMode,
      matcherModelId,
      matcherModelVersion,
      intelligenceModelId: intelModel.id,
      intelligenceModelVersion: intelModel.extractionModelVersion,
      schemaVersion: intelModel.schemaVersion,
      configHash: hash,
      initiatedByUserId: input.userId,
      startedAt: new Date(),
    },
  });

  try {
    const execArgs: Parameters<typeof executeLabRun>[0] = {
      prisma: input.prisma,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      jobName: job.name,
      associationMode: input.associationMode,
      matcherModelId,
      intelModel,
    };
    if (input.openaiApiKey !== undefined) {
      execArgs.openaiApiKey = input.openaiApiKey;
    }
    if (input.openaiModel !== undefined) {
      execArgs.openaiModel = input.openaiModel;
    }
    const result = await executeLabRun(execArgs);

    await input.prisma.jobIntelligenceLabRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        associationSnapshot: result.associations as object[],
        sourceEmailIds: result.sourceEmailIds,
        sourceAttachmentIds: result.sourceAttachmentIds,
        resultJson: result.resultJson as object,
        diagnostics: result.diagnostics as object,
        usage: result.usage as object,
        errorMessage: null,
      },
    });
    return { runId: run.id, status: "COMPLETED" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "lab_run_failed";
    await input.prisma.jobIntelligenceLabRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message.slice(0, 1000),
        diagnostics: { failure: message.slice(0, 500) },
      },
    });
    throw Object.assign(new Error(message), { statusCode: 500, runId: run.id });
  }
}

async function executeLabRun(input: {
  prisma: PrismaClient;
  workspaceId: string;
  jobId: string;
  jobName: string;
  associationMode: JobIntelligenceLabAssociationMode;
  matcherModelId: string;
  intelModel: ReturnType<typeof resolveJobIntelligenceModelForExecution>;
  openaiApiKey?: string | null;
  openaiModel?: string;
}): Promise<{
  associations: LabAssociationSnapshotEntry[];
  sourceEmailIds: string[];
  sourceAttachmentIds: string[];
  resultJson: {
    events: LabExtractedEventLite[];
    summarySections: unknown;
    limitations: string[];
    fullEvents?: Array<Record<string, unknown>>;
  };
  diagnostics: Record<string, unknown>;
  usage: Record<string, unknown>;
}> {
  const limitations: string[] = [];
  const emails = await input.prisma.emailMessage.findMany({
    where: { workspaceId: input.workspaceId },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: 500,
    select: {
      id: true,
      subject: true,
      bodyText: true,
      snippet: true,
      senderEmail: true,
      senderName: true,
      sentAt: true,
      inboxConnectionId: true,
      providerThreadId: true,
      jobId: true,
      jobAssignmentSource: true,
      jobAssignmentIsManual: true,
      normalizedEmail: { select: { cleanTextBody: true } },
      attachments: {
        where: { isInline: false },
        select: {
          id: true,
          filename: true,
          extractedText: true,
        },
        take: 6,
      },
    },
  });

  const associations: LabAssociationSnapshotEntry[] = [];
  let matcherRerunCount = 0;

  if (input.associationMode === "PRODUCTION_ASSIGNMENTS") {
    for (const email of emails) {
      if (email.jobId !== input.jobId) continue;
      const tier = classifyJobIntelligenceEligibility({
        jobId: email.jobId,
        jobAssignmentSource: email.jobAssignmentSource,
        jobAssignmentIsManual: email.jobAssignmentIsManual,
      });
      associations.push({
        emailMessageId: email.id,
        jobId: email.jobId,
        source: "PRODUCTION_ASSIGNMENT",
        eligibilityTier: tier,
      });
    }
    limitations.push(
      "Association mode PRODUCTION_ASSIGNMENTS uses stored EmailMessage.jobId — not a live matcher re-prediction."
    );
  } else {
    const snapshot = await loadJobMatchEvalSnapshot(
      input.prisma,
      input.workspaceId
    );
    const matcher = new JobMatcherService(
      createJobMatchEvalLoaderFromSnapshot(snapshot),
      null,
      { logCompletions: false }
    );
    if (!isJobMatchRunnablePolicyId(input.matcherModelId)) {
      throw new Error(`Cannot re-run retired matcher ${input.matcherModelId}`);
    }

    // Prefer emails already linked or likely related; cap for Lab cost control.
    const candidates = emails.slice(0, 200);
    for (const email of candidates) {
      if (associations.length >= LAB_MAX_EMAILS) {
        limitations.push(
          `Lab capped at ${LAB_MAX_EMAILS} emails associated to the target Job for this vertical slice.`
        );
        break;
      }

      if (isAuthoritativeAssignment(email) && email.jobId) {
        if (email.jobId === input.jobId) {
          associations.push({
            emailMessageId: email.id,
            jobId: email.jobId,
            source: "HUMAN_AUTHORITATIVE",
            eligibilityTier: "AUTHORITATIVE",
          });
        }
        continue;
      }

      matcherRerunCount += 1;
      const result = await matcher.match({
        workspaceId: input.workspaceId,
        emailMessageId: email.id,
        inboxConnectionId: email.inboxConnectionId,
        subject: email.subject,
        cleanBody:
          email.normalizedEmail?.cleanTextBody ??
          email.bodyText ??
          email.snippet ??
          null,
        senderEmail: email.senderEmail,
        providerThreadId: email.providerThreadId,
        eligibilityMode: "evaluation",
        identityPolicy: input.matcherModelId,
      });

      const predictedJobId =
        result.decision === "MATCH" ? result.selectedJobId : null;
      if (predictedJobId === input.jobId) {
        associations.push({
          emailMessageId: email.id,
          jobId: predictedJobId,
          source: "MATCHER_PREDICTION",
          matcherDecision: result.decision ?? null,
          eligibilityTier: "HIGH_CONFIDENCE_AI",
        });
      }
    }
    limitations.push(
      `Matcher policy ${input.matcherModelId} re-run in-memory (${matcherRerunCount} emails). EmailMessage.jobId was not written.`
    );
  }

  // Eligibility filter for automatic aggregation
  const eligibleAssociations = associations.filter((a) => {
    if (!a.jobId) return false;
    const tier = (a.eligibilityTier ?? "REVIEW_ONLY") as
      | "AUTHORITATIVE"
      | "HIGH_CONFIDENCE_AI"
      | "REVIEW_ONLY"
      | "EXCLUDED";
    return isEligibleForAutomaticAggregation(tier);
  });

  const emailById = new Map(emails.map((e) => [e.id, e]));
  const client = createOpenAIClient(
    input.openaiApiKey ? { apiKey: input.openaiApiKey } : {}
  );
  const extractor = new OpenAIJobIntelligenceExtractor(
    client,
    input.openaiModel
  );
  const summarizer = new OpenAIJobIntelligenceSummarizer(
    client,
    input.openaiModel
  );

  if (!extractor.isConfigured()) {
    limitations.push("OpenAI not configured — Lab returned empty extraction.");
  }

  const events: LabExtractedEventLite[] = [];
  const sourceAttachmentIds: string[] = [];
  let extractedEventPayload: Array<Record<string, unknown>> = [];

  for (const assoc of eligibleAssociations.slice(0, LAB_MAX_EMAILS)) {
    const email = emailById.get(assoc.emailMessageId);
    if (!email) continue;
    const prepared = prepareEmailBodyForExtraction(
      email.normalizedEmail?.cleanTextBody ?? email.bodyText
    );
    const attachments = (email.attachments ?? []).map((a) => {
      sourceAttachmentIds.push(a.id);
      return {
        id: a.id,
        filename: a.filename,
        extractedText: (a.extractedText ?? "").slice(
          0,
          JOB_INTELLIGENCE_MAX_ATTACHMENT_CHARS
        ),
      };
    });

    if (!extractor.isConfigured()) continue;

    const extraction = await extractor.extract({
      emailId: email.id,
      subject: email.subject ?? "",
      currentBody: prepared.currentText.slice(0, JOB_INTELLIGENCE_MAX_BODY_CHARS),
      senderEmail: email.senderEmail,
      senderName: email.senderName,
      sentAt: email.sentAt?.toISOString() ?? null,
      attachments,
    });

    for (const ev of extraction.events) {
      events.push({
        category: ev.category,
        title: ev.title,
        status: ev.status,
        financialKind: ev.financialKind,
        amount: ev.amount,
        contentFingerprint: ev.contentFingerprint,
        evidenceCount: ev.evidence.length,
      });
      extractedEventPayload.push({
        id: `lab-${ev.contentFingerprint}`,
        ...ev,
      });
    }
  }

  const summarySections = await summarizer.summarize({
    jobName: input.jobName,
    events: extractedEventPayload.map((e) => ({
      id: String(e.id),
      category: e.category,
      title: e.title,
      description: e.description,
      status: e.status,
      financialKind: e.financialKind,
      amount: e.amount,
      eventDate: e.eventDate ?? null,
    })),
  });

  return {
    associations,
    sourceEmailIds: associations.map((a) => a.emailMessageId),
    sourceAttachmentIds: [...new Set(sourceAttachmentIds)],
    resultJson: {
      events,
      summarySections,
      limitations,
      fullEvents: extractedEventPayload.slice(0, 100),
    },
    diagnostics: {
      associationMode: input.associationMode,
      matcherModelId: input.matcherModelId,
      intelligenceModelId: input.intelModel.id,
      eligibleAssociationCount: eligibleAssociations.length,
      associationCount: associations.length,
      matcherRerunCount,
      databaseWrites: "NONE",
      productionTablesTouched: false,
    },
    usage: {
      note: "Token accounting not yet wired for Lab vertical slice",
      inputTokens: null,
      outputTokens: null,
    },
  };
}

export async function listJobIntelligenceLabRuns(input: {
  prisma: PrismaClient;
  workspaceId: string;
  jobId?: string | null;
  limit?: number;
}) {
  return input.prisma.jobIntelligenceLabRun.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 30,
    select: {
      id: true,
      jobId: true,
      status: true,
      associationMode: true,
      matcherModelId: true,
      intelligenceModelId: true,
      intelligenceModelVersion: true,
      configHash: true,
      errorMessage: true,
      createdAt: true,
      completedAt: true,
      diagnostics: true,
    },
  });
}

export async function getJobIntelligenceLabRun(input: {
  prisma: PrismaClient;
  workspaceId: string;
  runId: string;
}) {
  const run = await input.prisma.jobIntelligenceLabRun.findFirst({
    where: { id: input.runId, workspaceId: input.workspaceId },
  });
  if (!run) {
    throw Object.assign(new Error("Lab run not found"), { statusCode: 404 });
  }
  return run;
}

export async function compareLabRunsService(input: {
  prisma: PrismaClient;
  workspaceId: string;
  runIds: string[];
}) {
  if (input.runIds.length < 2 || input.runIds.length > 4) {
    throw Object.assign(new Error("Select 2–4 lab runs to compare"), {
      statusCode: 400,
    });
  }
  const runs = await input.prisma.jobIntelligenceLabRun.findMany({
    where: {
      workspaceId: input.workspaceId,
      id: { in: input.runIds },
      status: "COMPLETED",
    },
  });
  if (runs.length !== input.runIds.length) {
    throw Object.assign(
      new Error("All selected runs must exist, belong to this workspace, and be COMPLETED"),
      { statusCode: 400 }
    );
  }

  const compareInputs: LabRunCompareInput[] = runs.map((r) => {
    const result = (r.resultJson ?? {}) as {
      events?: LabExtractedEventLite[];
      summarySections?: Record<string, { text?: string }>;
    };
    const associations = (r.associationSnapshot ??
      []) as LabAssociationSnapshotEntry[];
    const summaryTextBySection: Record<string, string> = {};
    if (result.summarySections) {
      for (const [k, v] of Object.entries(result.summarySections)) {
        if (v?.text) summaryTextBySection[k] = v.text;
      }
    }
    const item: LabRunCompareInput = {
      runId: r.id,
      label: `${r.matcherModelId} + ${r.intelligenceModelId}`,
      matcherModelId: r.matcherModelId,
      intelligenceModelId: r.intelligenceModelId,
      associationMode: r.associationMode,
      associations,
      events: result.events ?? [],
      summaryTextBySection,
      diagnostics: (r.diagnostics as Record<string, unknown> | null) ?? null,
      usage: (r.usage as LabRunCompareInput["usage"]) ?? null,
    };
    return item;
  });

  return compareJobIntelligenceLabRuns(compareInputs);
}
