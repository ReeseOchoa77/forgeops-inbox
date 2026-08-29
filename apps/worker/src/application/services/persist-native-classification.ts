import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { NativeClassificationPipelineResult } from "@forgeops/native-classification";
import {
  applyConfirmedJobAssociationOverride,
  buildJobCandidateMarker,
  mapN8nPriorityToStored,
  NATIVE_PIPELINE_MODEL_NAME,
  NATIVE_PIPELINE_MODEL_VERSION,
  resolveConfirmedWorkspaceJob,
  type StoredPriority,
} from "@forgeops/shared";

import { persistJobMatchResult } from "./persist-job-match.js";
import { createJobMatcherService } from "./prisma-job-match-loader.js";
import { normalizeEmailMessage } from "./normalize-email-message.js";

const CLASSIFICATION_REVIEW_THRESHOLD = 0.8;
const TASK_REVIEW_THRESHOLD = 0.75;

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

const toConfidence = (value: number): Prisma.Decimal =>
  new Prisma.Decimal(Math.max(0, Math.min(1, value)).toFixed(4));

function nativeTaskKey(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const hash = createHash("sha256")
    .update(`${index}:${title}`)
    .digest("hex")
    .slice(0, 8);
  return `native:${index}:${slug || "task"}:${hash}`;
}

/**
 * Temporary native job assignment source-of-truth (matches n8n ingest):
 * - AI entity selectedCustomerId / selectedVendorId / entityMatchConfidence / matchEvidence
 *   are written from the entity-selection model.
 * - AI selectedJobId is stored ONLY in rawAiPayload / evidence as a hint.
 * - Classification.jobId + EmailMessage.jobId are owned by JobMatcherService
 *   (JobMatcher may overwrite entityMatchConfidence/matchEvidence afterward, same as n8n).
 */
export async function persistNativeClassificationResult(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  emailMessageId: string;
  pipeline: NativeClassificationPipelineResult;
}): Promise<{
  classificationId: string;
  tasksWritten: number;
  mailboxCategory: "BUSINESS" | "PERSONAL";
  priority: StoredPriority;
}> {
  const message = await input.prisma.emailMessage.findFirst({
    where: {
      id: input.emailMessageId,
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
    },
    select: {
      id: true,
      threadId: true,
      subject: true,
      senderName: true,
      senderEmail: true,
      toAddresses: true,
      ccAddresses: true,
      bccAddresses: true,
      replyToAddresses: true,
      snippet: true,
      bodyText: true,
      labelIds: true,
      sentAt: true,
      receivedAt: true,
      jobId: true,
      jobAssignmentIsManual: true,
      jobAssignmentSource: true,
      attachmentMetadata: true,
      thread: { select: { subject: true } },
    },
  });
  if (!message) {
    throw new Error(`EmailMessage not found: ${input.emailMessageId}`);
  }

  const signals = input.pipeline.semanticSignals;
  let decision = input.pipeline.mailboxDecision;
  const subtype = input.pipeline.businessSubtype;
  const entities = input.pipeline.entities;
  const tasks = input.pipeline.tasks;
  const priorityDecision = input.pipeline.priorityDecision;
  const storedPriority = mapN8nPriorityToStored(priorityDecision.priority);
  let mailboxCategory = decision.mailboxCategory;

  const confidence = Math.max(
    signals.contentBusinessProbability,
    signals.subjectBusinessProbability,
    signals.jobReferenceConfidence,
    subtype?.businessTypeConfidence ?? 0,
    entities?.entityMatchConfidence ?? 0
  );

  let requiresReview =
    decision.requiresReview || confidence < CLASSIFICATION_REVIEW_THRESHOLD;
  if (
    mailboxCategory === "BUSINESS" &&
    subtype?.businessTypeConfidence != null &&
    subtype.businessTypeConfidence < CLASSIFICATION_REVIEW_THRESHOLD
  ) {
    requiresReview = true;
  }
  if (
    entities?.entityMatchConfidence != null &&
    entities.entityMatchConfidence < CLASSIFICATION_REVIEW_THRESHOLD &&
    (entities.selectedCustomerId || entities.selectedVendorId)
  ) {
    requiresReview = true;
  }

  const rawAiPayloadBase = {
    pipeline: "native-openai-pipeline",
    summary: signals.summary,
    containsActionRequest: signals.containsActionRequest,
    contentBusinessProbability: signals.contentBusinessProbability,
    subjectBusinessProbability: signals.subjectBusinessProbability,
    signatureCompanyMatchConfidence: signals.signatureCompanyMatchConfidence,
    jobReferenceConfidence: signals.jobReferenceConfidence,
    hasExplicitDeadline: signals.hasExplicitDeadline,
    deadlineUrgency: signals.deadlineUrgency,
    signalExplanations: signals.signalExplanations,
    businessType: subtype?.businessType ?? null,
    businessTypeConfidence: subtype?.businessTypeConfidence ?? null,
    selectedCustomerId: entities?.selectedCustomerId ?? null,
    selectedVendorId: entities?.selectedVendorId ?? null,
    /** Hint only — JobMatcher owns Classification.jobId (n8n parity). */
    selectedJobId: entities?.selectedJobId ?? null,
    entityMatchConfidence: entities?.entityMatchConfidence ?? null,
    matchEvidence: entities?.matchEvidence ?? [],
    tasks,
    priority: priorityDecision.priority,
    priorityDecision,
    skippedStages: input.pipeline.skippedStages,
    candidateLookupFailed: input.pipeline.candidateLookupFailed,
  };

  const normalized = normalizeEmailMessage({
    subject: message.subject,
    threadSubject: message.thread.subject,
    snippet: message.snippet,
    bodyText: message.bodyText,
    receivedAt: message.receivedAt ?? message.sentAt,
    senderName: message.senderName,
    senderEmail: message.senderEmail,
    toAddresses: message.toAddresses,
    ccAddresses: message.ccAddresses,
    bccAddresses: message.bccAddresses,
    replyToAddresses: message.replyToAddresses,
    labelIds: message.labelIds,
  });

  const jobMatcher = createJobMatcherService(input.prisma);
  let jobMatch: Awaited<ReturnType<typeof jobMatcher.match>> | null = null;
  if (mailboxCategory === "BUSINESS") {
    try {
      jobMatch = await jobMatcher.match({
        workspaceId: input.workspaceId,
        emailMessageId: message.id,
        subject: message.subject,
        normalizedSubject: normalized.normalizedSubject,
        bodyText: message.bodyText,
        cleanBody: normalized.cleanTextBody,
        senderEmail: message.senderEmail,
        senderDomain: normalized.senderDomain,
        threadId: message.threadId,
        n8nSelectedJobIdHint: entities?.selectedJobId ?? null,
      });
      if (jobMatch.requiresReview) requiresReview = true;
    } catch (e) {
      console.warn("native-job-match-failed", {
        emailMessageId: message.id,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  // Feedback: JobMatcher-selected job is a confirmed association → BUSINESS.
  // (Flags B/P runs before matching; this closes the loop without re-entering AI.)
  if (jobMatch?.selectedJobId) {
    const matchedJob = await input.prisma.job.findFirst({
      where: {
        id: jobMatch.selectedJobId,
        workspaceId: input.workspaceId,
      },
      select: {
        id: true,
        workspaceId: true,
        jobNumber: true,
        name: true,
      },
    });
    const confirmed = resolveConfirmedWorkspaceJob({
      workspaceId: input.workspaceId,
      job: matchedJob,
    });
    if (confirmed) {
      const overridden = applyConfirmedJobAssociationOverride(
        decision,
        confirmed,
        "job_matcher"
      );
      decision = overridden;
      mailboxCategory = "BUSINESS";
      if (overridden.overridden) requiresReview = false;
    }
  }

  const jobCandidate = buildJobCandidateMarker({
    jobReferenceConfidence: signals.jobReferenceConfidence,
    explanation: signals.signalExplanations.job,
    hintedJobId: entities?.selectedJobId ?? null,
  });

  const classificationEvidence = {
    ...decision.classificationEvidence,
    decisionRule: decision.decisionRule,
    classificationDecision: decision.classificationDecision,
    priorityDecision,
    nativeEntityHint: {
      selectedJobId: entities?.selectedJobId ?? null,
    },
    jobCandidate: jobCandidate ?? { status: "NONE" as const },
    // Rewrite every persist so removed jobs do not leave a stale confirmed marker.
    jobAssociation:
      decision.classificationEvidence &&
      typeof decision.classificationEvidence === "object" &&
      (decision.classificationEvidence as { jobAssociation?: { status?: string } })
        .jobAssociation?.status === "CONFIRMED"
        ? (decision.classificationEvidence as { jobAssociation: unknown })
            .jobAssociation
        : { status: "NONE" as const },
  };

  const rawAiPayload = {
    ...rawAiPayloadBase,
    mailboxCategory,
    classificationDecision: decision.classificationDecision,
  };

  const itemStatus = requiresReview ? "NEEDS_REVIEW" : "NEW";
  const reviewQueue = requiresReview ? "TRIAGE" : null;
  const reviewStatus = requiresReview ? "PENDING" : "NOT_REQUIRED";

  const result = await input.prisma.$transaction(async (tx) => {
    await tx.normalizedEmail.upsert({
      where: {
        workspaceId_messageId: {
          workspaceId: input.workspaceId,
          messageId: message.id,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        threadId: message.threadId,
        messageId: message.id,
        sender: toPrismaJson(normalized.sender),
        recipients: toPrismaJson(normalized.recipients),
        subject: normalized.subject,
        normalizedSubject: normalized.normalizedSubject,
        snippet: normalized.snippet,
        cleanTextBody: normalized.cleanTextBody,
        receivedAt: normalized.receivedAt,
        labelHints: normalized.labelHints,
        categoryHints: normalized.categoryHints,
        senderDomain: normalized.senderDomain,
      },
      update: {
        sender: toPrismaJson(normalized.sender),
        recipients: toPrismaJson(normalized.recipients),
        subject: normalized.subject,
        normalizedSubject: normalized.normalizedSubject,
        snippet: normalized.snippet,
        cleanTextBody: normalized.cleanTextBody,
        receivedAt: normalized.receivedAt,
        labelHints: normalized.labelHints,
        categoryHints: normalized.categoryHints,
        senderDomain: normalized.senderDomain,
      },
    });

    const classification = await tx.classification.upsert({
      where: {
        workspaceId_messageId: {
          workspaceId: input.workspaceId,
          messageId: message.id,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        threadId: message.threadId,
        messageId: message.id,
        businessCategory:
          mailboxCategory === "BUSINESS" ? "BUSINESS" : "NON_BUSINESS",
        mailboxCategory,
        mailboxConfidence: toConfidence(
          Math.max(
            signals.contentBusinessProbability,
            signals.subjectBusinessProbability
          )
        ),
        emailType: signals.containsActionRequest
          ? "ACTIONABLE_REQUEST"
          : "FYI_UPDATE",
        priority: storedPriority,
        itemStatus,
        summary: signals.summary,
        deadline: null,
        containsActionRequest: signals.containsActionRequest,
        businessTypeKey: subtype?.businessType ?? null,
        businessTypeConfidence:
          subtype?.businessTypeConfidence != null
            ? toConfidence(subtype.businessTypeConfidence)
            : null,
        customerId: entities?.selectedCustomerId ?? null,
        vendorId: entities?.selectedVendorId ?? null,
        jobId: null,
        entityMatchConfidence:
          entities?.entityMatchConfidence != null
            ? toConfidence(entities.entityMatchConfidence)
            : null,
        matchEvidence: entities?.matchEvidence
          ? toPrismaJson(entities.matchEvidence)
          : Prisma.JsonNull,
        routingHints: toPrismaJson({
          source: "native-openai-pipeline",
          decisionRule: decision.decisionRule,
        }),
        extractedFields: toPrismaJson({
          sender: normalized.sender,
          recipients: normalized.recipients,
          cleanTextBody: normalized.cleanTextBody,
        }),
        classificationEvidence: toPrismaJson(classificationEvidence),
        rawAiPayload: toPrismaJson(rawAiPayload),
        confidence: toConfidence(confidence),
        requiresReview,
        reviewQueue,
        reviewStatus,
        modelName: NATIVE_PIPELINE_MODEL_NAME,
        modelVersion: NATIVE_PIPELINE_MODEL_VERSION,
        processedAt: new Date(),
      },
      update: {
        threadId: message.threadId,
        businessCategory:
          mailboxCategory === "BUSINESS" ? "BUSINESS" : "NON_BUSINESS",
        mailboxCategory,
        mailboxConfidence: toConfidence(
          Math.max(
            signals.contentBusinessProbability,
            signals.subjectBusinessProbability
          )
        ),
        emailType: signals.containsActionRequest
          ? "ACTIONABLE_REQUEST"
          : "FYI_UPDATE",
        priority: storedPriority,
        itemStatus,
        summary: signals.summary,
        containsActionRequest: signals.containsActionRequest,
        businessTypeKey: subtype?.businessType ?? null,
        businessTypeConfidence:
          subtype?.businessTypeConfidence != null
            ? toConfidence(subtype.businessTypeConfidence)
            : null,
        customerId: entities?.selectedCustomerId ?? null,
        vendorId: entities?.selectedVendorId ?? null,
        entityMatchConfidence:
          entities?.entityMatchConfidence != null
            ? toConfidence(entities.entityMatchConfidence)
            : null,
        matchEvidence: entities?.matchEvidence
          ? toPrismaJson(entities.matchEvidence)
          : Prisma.JsonNull,
        routingHints: toPrismaJson({
          source: "native-openai-pipeline",
          decisionRule: decision.decisionRule,
        }),
        extractedFields: toPrismaJson({
          sender: normalized.sender,
          recipients: normalized.recipients,
          cleanTextBody: normalized.cleanTextBody,
        }),
        classificationEvidence: toPrismaJson(classificationEvidence),
        rawAiPayload: toPrismaJson(rawAiPayload),
        confidence: toConfidence(confidence),
        requiresReview,
        reviewQueue,
        reviewStatus,
        reviewedByUserId: null,
        reviewedAt: null,
        modelName: NATIVE_PIPELINE_MODEL_NAME,
        modelVersion: NATIVE_PIPELINE_MODEL_VERSION,
        processedAt: new Date(),
      },
    });

    if (jobMatch) {
      await persistJobMatchResult(tx, {
        classificationId: classification.id,
        emailMessageId: message.id,
        match: jobMatch,
        existing: {
          jobId: message.jobId,
          jobAssignmentIsManual: message.jobAssignmentIsManual,
          jobAssignmentSource: message.jobAssignmentSource,
        },
      });
    }

    const incomingKeys = new Set<string>();
    let tasksWritten = 0;
    if (mailboxCategory === "BUSINESS") {
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]!;
        const sourceTaskKey = nativeTaskKey(task.title, i);
        incomingKeys.add(sourceTaskKey);
        const taskRequiresReview = task.confidence < TASK_REVIEW_THRESHOLD;
        const dueAt = task.dueDate ? new Date(task.dueDate) : null;

        await tx.task.upsert({
          where: {
            workspaceId_sourceMessageId_sourceTaskKey: {
              workspaceId: input.workspaceId,
              sourceMessageId: message.id,
              sourceTaskKey,
            },
          },
          update: {
            sourceThreadId: message.threadId,
            classificationId: classification.id,
            title: task.title,
            summary: task.description || null,
            description: task.description || null,
            assigneeGuess: task.recommendedOwner ?? null,
            dueAt,
            priority: storedPriority,
            confidence: toConfidence(task.confidence),
            requiresReview: taskRequiresReview,
            reviewQueue: taskRequiresReview ? "EXTRACTION" : null,
            reviewStatus: taskRequiresReview ? "PENDING" : "NOT_REQUIRED",
            reviewedByUserId: null,
            reviewedAt: null,
            completedAt: null,
            status: "OPEN",
          },
          create: {
            workspaceId: input.workspaceId,
            sourceThreadId: message.threadId,
            sourceMessageId: message.id,
            sourceTaskKey,
            classificationId: classification.id,
            title: task.title,
            summary: task.description || null,
            description: task.description || null,
            assigneeGuess: task.recommendedOwner ?? null,
            dueAt,
            priority: storedPriority,
            status: "OPEN",
            confidence: toConfidence(task.confidence),
            requiresReview: taskRequiresReview,
            reviewQueue: taskRequiresReview ? "EXTRACTION" : null,
            reviewStatus: taskRequiresReview ? "PENDING" : "NOT_REQUIRED",
          },
        });
        tasksWritten += 1;
      }
    }

    // Remove prior native/heuristic tasks for this message that are no longer produced.
    const stale = await tx.task.findMany({
      where: {
        workspaceId: input.workspaceId,
        sourceMessageId: message.id,
        OR: [
          { sourceTaskKey: { startsWith: "native:" } },
          { sourceTaskKey: "heuristic-primary" },
        ],
      },
      select: { id: true, sourceTaskKey: true },
    });
    const staleIds = stale
      .filter((t) => t.sourceTaskKey != null && !incomingKeys.has(t.sourceTaskKey))
      .map((t) => t.id);
    if (staleIds.length > 0) {
      await tx.task.deleteMany({ where: { id: { in: staleIds } } });
    }

    await tx.emailMessage.update({
      where: { id: message.id },
      data: {
        mailboxCategory,
        priority: storedPriority,
        itemStatus,
      },
    });

    await tx.emailThread.update({
      where: { id: message.threadId },
      data: {
        priority: storedPriority,
        itemStatus,
        latestClassificationConfidence: toConfidence(confidence),
        reviewQueue,
        reviewStatus,
      },
    });

    return {
      classificationId: classification.id,
      tasksWritten,
      mailboxCategory,
      priority: storedPriority,
    };
  });

  return result;
}
