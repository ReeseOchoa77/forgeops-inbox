import {
  createOpenAIClient,
  OpenAIBusinessSubtypeClassifier,
  OpenAIEntitySelector,
  OpenAISemanticSignalExtractor,
  OpenAITaskExtractor,
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
  const baseLog = {
    workspaceId: payload.workspaceId,
    inboxConnectionId: payload.inboxConnectionId,
    emailMessageId: payload.emailMessageId,
    modelName: NATIVE_PIPELINE_MODEL_NAME,
    modelVersion: NATIVE_PIPELINE_MODEL_VERSION,
  };

  console.info({ event: "native-classification-started", ...baseLog });

  try {
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
    });

    const durationMs = Date.now() - started;
    console.info({
      event: "native-classification-completed",
      ...baseLog,
      status: "completed",
      mailboxCategory: persisted.mailboxCategory,
      durationMs,
    });

    return {
      ...payload,
      status: "completed",
      modelName: NATIVE_PIPELINE_MODEL_NAME,
      modelVersion: NATIVE_PIPELINE_MODEL_VERSION,
      mailboxCategory: persisted.mailboxCategory,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error({
      event: "native-classification-failed",
      ...baseLog,
      durationMs: Date.now() - started,
      error: message,
    });
    // Rethrow so BullMQ retries independently per message.
    throw error instanceof Error ? error : new Error(message);
  }
}
