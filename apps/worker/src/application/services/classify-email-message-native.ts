import {
  createOpenAIClient,
  OpenAIBusinessSubtypeClassifier,
  OpenAIEntitySelector,
  OpenAISemanticSignalExtractor,
  OpenAITaskExtractor,
  normalizeOpenAiApiKey,
  serializeOpenAiError,
} from "@forgeops/ai";
import {
  ClassificationCandidatesService,
  runNativeClassificationPipeline,
} from "@forgeops/native-classification";
import {
  buildClassificationWriteLog,
  extractDomain,
  NATIVE_PIPELINE_MODEL_NAME,
  NATIVE_PIPELINE_MODEL_VERSION,
  resolveConfirmedWorkspaceJob,
  shouldRunProductionNativeClassification,
  shouldSkipNativeClassificationOverwrite,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
} from "@forgeops/shared";
import type { PrismaClient } from "@prisma/client";

import { persistNativeClassificationResult } from "./persist-native-classification.js";

function attachmentNamesFromMetadata(metadata: unknown): string[] {
  if (!Array.isArray(metadata)) return [];
  const names: string[] = [];
  for (const item of metadata) {
    if (!item || typeof item !== "object") continue;
    const name =
      (item as { name?: unknown; filename?: unknown }).name ??
      (item as { filename?: unknown }).filename;
    if (typeof name === "string" && name.trim()) names.push(name.trim());
  }
  return names;
}

export interface ClassifyEmailMessageDeps {
  prisma: PrismaClient;
  openaiApiKey?: string | undefined;
  openaiSemanticModel: string;
  openaiSubtypeModel: string;
  openaiEntityModel: string;
  openaiTaskModel: string;
}

/**
 * Message-scoped production native classification.
 * Does NOT call classifyNormalizedEmail / rules-normalizer.
 */
export async function classifyEmailMessageNative(
  payload: MailboxClassifyJobPayload,
  deps: ClassifyEmailMessageDeps
): Promise<MailboxClassifyJobResult> {
  const started = Date.now();
  const openaiConfigured = Boolean(normalizeOpenAiApiKey(deps.openaiApiKey));
  const baseLog = {
    workspaceId: payload.workspaceId,
    inboxConnectionId: payload.inboxConnectionId,
    emailMessageId: payload.emailMessageId,
    modelName: NATIVE_PIPELINE_MODEL_NAME,
    modelVersion: NATIVE_PIPELINE_MODEL_VERSION,
    openaiConfigured,
    semanticModel: deps.openaiSemanticModel,
    customBaseUrl: false,
  };

  console.info({ event: "native-classification-started", ...baseLog });

  try {
    await deps.prisma.emailMessage
      .updateMany({
        where: {
          id: payload.emailMessageId,
          workspaceId: payload.workspaceId,
        },
        data: {
          classificationStatus: "PROCESSING",
          classificationLastAttemptAt: new Date(),
        },
      })
      .catch(() => {});

    const connection = await deps.prisma.inboxConnection.findFirst({
      where: {
        id: payload.inboxConnectionId,
        workspaceId: payload.workspaceId,
      },
      select: {
        id: true,
        email: true,
        ingestionSource: true,
      },
    });

    if (!connection) {
      throw new Error("Inbox connection not found");
    }

    if (!shouldRunProductionNativeClassification(connection)) {
      console.info({
        event: "native-classification-completed",
        ...baseLog,
        status: "skipped",
        skipReason: "n8n_or_non_native_mode",
        durationMs: Date.now() - started,
      });
      return {
        ...payload,
        status: "skipped",
        skipReason: "n8n_or_non_native_mode",
        durationMs: Date.now() - started,
      };
    }

    const existingClassification = await deps.prisma.classification.findFirst({
      where: {
        workspaceId: payload.workspaceId,
        messageId: payload.emailMessageId,
      },
      select: {
        modelName: true,
        reviewStatus: true,
        mailboxCategory: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (shouldSkipNativeClassificationOverwrite(existingClassification)) {
      if (!payload.forceReclassify) {
        console.info({
          event: "native-classification-completed",
          ...baseLog,
          status: "skipped",
          skipReason: "n8n_or_manual_owned",
          durationMs: Date.now() - started,
          ...buildClassificationWriteLog({
            workspaceId: payload.workspaceId,
            inboxConnectionId: payload.inboxConnectionId,
            emailMessageId: payload.emailMessageId,
            source: "NATIVE_ANALYSIS",
            previousCategory: existingClassification?.mailboxCategory ?? null,
            newCategory: existingClassification?.mailboxCategory ?? null,
            modelName: existingClassification?.modelName ?? null,
          }),
        });
        return {
          ...payload,
          status: "skipped",
          skipReason: "n8n_or_manual_owned",
          durationMs: Date.now() - started,
        };
      }
      // forceReclassify: overwrite native classifications (protected Job still preserved at persist).
      console.info({
        event: "native-classification-force-overwrite",
        ...baseLog,
        previousModelName: existingClassification?.modelName ?? null,
        previousReviewStatus: existingClassification?.reviewStatus ?? null,
      });
    }

    const message = await deps.prisma.emailMessage.findFirst({
      where: {
        id: payload.emailMessageId,
        workspaceId: payload.workspaceId,
        inboxConnectionId: payload.inboxConnectionId,
      },
      select: {
        id: true,
        subject: true,
        senderName: true,
        senderEmail: true,
        bodyText: true,
        attachmentMetadata: true,
        jobId: true,
        jobAssignmentSource: true,
        job: {
          select: {
            id: true,
            workspaceId: true,
            jobNumber: true,
            name: true,
          },
        },
        normalizedEmail: {
          select: {
            normalizedSubject: true,
            cleanTextBody: true,
            senderDomain: true,
            subject: true,
          },
        },
      },
    });

    if (!message) {
      throw new Error(`EmailMessage not found: ${payload.emailMessageId}`);
    }

    const confirmedJobAssociation = resolveConfirmedWorkspaceJob({
      workspaceId: payload.workspaceId,
      job: message.job,
    });

    // No custom baseURL is passed — SDK default endpoint (api.openai.com).
    // API key is trimmed inside createOpenAIClient (centralized).
    const openaiClient = createOpenAIClient({
      ...(deps.openaiApiKey ? { apiKey: deps.openaiApiKey } : {}),
    });
    const candidatesService = new ClassificationCandidatesService(deps.prisma);

    const normalizedSubject =
      message.normalizedEmail?.normalizedSubject?.trim() ||
      message.normalizedEmail?.subject?.trim() ||
      message.subject?.trim() ||
      "";
    const cleanBody =
      message.normalizedEmail?.cleanTextBody ?? message.bodyText ?? "";
    const senderDomain =
      message.normalizedEmail?.senderDomain?.trim() ||
      extractDomain(message.senderEmail ?? "") ||
      "";

    const pipeline = await runNativeClassificationPipeline(
      {
        workspaceId: payload.workspaceId,
        mailboxEmail: connection.email,
        normalizedSubject,
        subject: message.subject,
        cleanBody,
        senderName: message.senderName,
        senderEmail: message.senderEmail,
        senderDomain,
        attachmentNames: attachmentNamesFromMetadata(message.attachmentMetadata),
        ...(payload.taskMode === "REMOVE_ONLY"
          ? { skipTaskExtraction: true }
          : {}),
        ...(confirmedJobAssociation
          ? {
              confirmedJobAssociation,
              confirmedJobAssociationSource:
                message.jobAssignmentSource === "VERIFIED_PROJECT_FOLDER"
                  ? "verified_project_folder"
                  : "existing_message_job",
            }
          : {}),
      },
      {
        candidatesService,
        semanticSignalExtractor: new OpenAISemanticSignalExtractor(
          openaiClient,
          deps.openaiSemanticModel
        ),
        businessSubtypeClassifier: new OpenAIBusinessSubtypeClassifier(
          openaiClient,
          deps.openaiSubtypeModel
        ),
        entitySelector: new OpenAIEntitySelector(
          openaiClient,
          deps.openaiEntityModel
        ),
        taskExtractor: new OpenAITaskExtractor(
          openaiClient,
          deps.openaiTaskModel
        ),
      }
    );

    const persisted = await persistNativeClassificationResult({
      prisma: deps.prisma,
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      emailMessageId: payload.emailMessageId,
      pipeline,
      ...(payload.taskMode ? { taskMode: payload.taskMode } : {}),
    });

    const durationMs = Date.now() - started;
    console.info({
      event: "native-classification-completed",
      ...baseLog,
      status: "completed",
      mailboxCategory: persisted.mailboxCategory,
      taskMode: payload.taskMode ?? null,
      tasksWritten: persisted.tasksWritten,
      tasksRemoved: persisted.tasksRemoved,
      tasksFailed: persisted.tasksFailed,
      durationMs,
    });

    return {
      ...payload,
      status: "completed",
      modelName: NATIVE_PIPELINE_MODEL_NAME,
      modelVersion: NATIVE_PIPELINE_MODEL_VERSION,
      mailboxCategory: persisted.mailboxCategory,
      durationMs,
      tasksRemoved: persisted.tasksRemoved,
      tasksGenerated: persisted.tasksWritten,
      taskPersistFailures: persisted.tasksFailed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const openaiError = serializeOpenAiError(error);
    const failureStage = inferNativeClassificationFailureStage(message);
    console.error({
      event: "native-classification-failed",
      ...baseLog,
      failureStage,
      durationMs: Date.now() - started,
      error: message.slice(0, 480),
      ...openaiError,
    });
    // Rethrow so BullMQ retries independently per message.
    // Optional task enrichment failures are handled inside persist and do not reach here.
    throw error instanceof Error ? error : new Error(message);
  }
}

function inferNativeClassificationFailureStage(message: string): string {
  if (/semantic signal|semantic signals|for semantic/i.test(message)) {
    return "semantic";
  }
  if (/business subtype/i.test(message)) return "subtype";
  if (/entity selection/i.test(message)) return "entity";
  if (/task extraction/i.test(message)) return "task_extract";
  if (/senderEmail is not a valid email|CLASSIFICATION_PERSIST_FAILED/i.test(message)) {
    return "classification_persist";
  }
  if (/EmailMessage not found|Inbox connection not found/i.test(message)) {
    return "load";
  }
  if (/prisma\.(classification|normalizedEmail)/i.test(message)) {
    return "classification_persist";
  }
  if (/prisma\.task/i.test(message)) return "task_persist";
  if (/OpenAI is not configured/i.test(message)) return "openai_config";
  return "unknown";
}
