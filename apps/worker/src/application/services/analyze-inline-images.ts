import type { PrismaClient } from "@prisma/client";
import {
  INLINE_IMAGE_MODEL_HASH_MIN_CONFIDENCE,
  INLINE_IMAGE_PAGE_SIZE,
  INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
  InlineImageVisionUnavailableError,
  analyzeInlineImageBatch,
  classifyInlineImageWithVision,
  createOpenAIClient,
  inlineImageCandidateWhere,
  type HashReuseSource,
  type InlineImageRelevanceBatchResult,
  type InlineImageRelevanceSave,
} from "@forgeops/ai";
import {
  buildInlineImageRelevanceJobId,
  QueueNames,
  type InlineImageRelevanceJobPayload,
  type InlineImageRelevanceJobResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

const MAX_PAGES = 400;
const RECURRENCE_SAMPLE = 400;

export async function processInlineImageRelevanceJob(input: {
  prisma: PrismaClient;
  payload: InlineImageRelevanceJobPayload;
  readObject: (storageKey: string) => Promise<Buffer>;
  openaiApiKey: string | undefined;
  model: string;
  queue: Queue<InlineImageRelevanceJobPayload, InlineImageRelevanceJobResult>;
}): Promise<InlineImageRelevanceJobResult> {
  const workspaceId = input.payload.workspaceId;
  const force = input.payload.force === true;
  const page = input.payload.page ?? 0;
  const afterAttachmentId = input.payload.afterAttachmentId ?? null;
  const runId = input.payload.runId ?? "run";
  const client = createOpenAIClient(
    input.openaiApiKey ? { apiKey: input.openaiApiKey } : {}
  );

  const stats = await analyzeInlineImageBatch({
    workspaceId,
    force,
    limit: INLINE_IMAGE_PAGE_SIZE,
    deps: {
      listCandidates: async () => {
        const rows = await input.prisma.emailAttachment.findMany({
          where: inlineImageCandidateWhere({
            workspaceId,
            force,
            ...(afterAttachmentId ? { afterAttachmentId } : {}),
          }),
          orderBy: { id: "asc" },
          take: INLINE_IMAGE_PAGE_SIZE,
          select: {
            id: true,
            workspaceId: true,
            isInline: true,
            mimeType: true,
            sizeBytes: true,
            checksum: true,
            storageKey: true,
          },
        });
        return rows;
      },
      countRemaining: (scopedWorkspaceId) =>
        input.prisma.emailAttachment.count({
          where: inlineImageCandidateWhere({ workspaceId: scopedWorkspaceId, force: false }),
        }),
      findExisting: async ({ workspaceId: scopedWorkspaceId, emailAttachmentId }) => {
        const row = await input.prisma.inlineImageRelevanceClassification.findUnique({
          where: {
            workspaceId_emailAttachmentId_analyzerVersion: {
              workspaceId: scopedWorkspaceId,
              emailAttachmentId,
              analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
            },
          },
        });
        if (!row || row.workspaceId !== scopedWorkspaceId) return null;
        return {
          emailAttachmentId: row.emailAttachmentId,
          workspaceId: row.workspaceId,
          relevance: row.relevance,
          noiseReason: row.noiseReason,
          confidence: row.confidence,
          method: row.method,
          evidence: row.evidence,
          contentChecksum: row.contentChecksum,
        };
      },
      findHumanHash: ({ workspaceId: scopedWorkspaceId, checksum, excludeAttachmentId }) =>
        findHash(input.prisma, {
          workspaceId: scopedWorkspaceId,
          checksum,
          excludeAttachmentId,
          method: "HUMAN",
          minConfidence: 0,
        }),
      findModelHash: ({ workspaceId: scopedWorkspaceId, checksum, excludeAttachmentId }) =>
        findHash(input.prisma, {
          workspaceId: scopedWorkspaceId,
          checksum,
          excludeAttachmentId,
          method: "VISION",
          minConfidence: INLINE_IMAGE_MODEL_HASH_MIN_CONFIDENCE,
        }),
      countRecurrence: async ({ workspaceId: scopedWorkspaceId, checksum }) => {
        const rows = await input.prisma.emailAttachment.findMany({
          where: {
            workspaceId: scopedWorkspaceId,
            checksum,
            isInline: true,
            uploadStatus: "UPLOADED",
          },
          select: {
            emailMessageId: true,
            emailMessage: { select: { threadId: true } },
          },
          take: RECURRENCE_SAMPLE,
        });
        const messages = new Set(rows.map((row) => row.emailMessageId));
        const threads = new Set(rows.map((row) => row.emailMessage.threadId));
        return { messageCount: messages.size, threadCount: threads.size };
      },
      readBytes: (storageKey) => input.readObject(storageKey),
      classifyVision: async (image) => {
        if (!client) throw new InlineImageVisionUnavailableError();
        return classifyInlineImageWithVision(client, input.model, image);
      },
      save: (row) => saveRelevance(input.prisma, row),
    },
  });

  const continued =
    stats.pageFull &&
    stats.lastAttachmentId != null &&
    page + 1 < MAX_PAGES;
  if (continued && stats.lastAttachmentId) {
    await input.queue.add(
      QueueNames.INLINE_IMAGE_RELEVANCE,
      {
        workspaceId,
        initiatedBy: input.payload.initiatedBy ?? "USER",
        force,
        afterAttachmentId: stats.lastAttachmentId,
        page: page + 1,
        runId,
      },
      {
        jobId: buildInlineImageRelevanceJobId(workspaceId, page + 1, runId),
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      }
    );
  }

  console.info("inline-image-relevance-page", {
    workspaceId,
    page,
    analyzed: stats.analyzed,
    reused: stats.reused,
    failed: stats.failed,
    unsupported: stats.unsupported,
    remaining: stats.remaining,
    visionCalls: stats.visionCalls,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    continued,
  });

  return toResult(workspaceId, stats, continued);
}

async function findHash(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    checksum: string;
    excludeAttachmentId: string;
    method: "HUMAN" | "VISION";
    minConfidence: number;
  }
): Promise<HashReuseSource | null> {
  const row = await prisma.inlineImageRelevanceClassification.findFirst({
    where: {
      workspaceId: input.workspaceId,
      contentChecksum: input.checksum,
      analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
      method: input.method,
      relevance: { in: ["RELEVANT", "NOISE"] },
      confidence: { gte: input.minConfidence },
      emailAttachmentId: { not: input.excludeAttachmentId },
    },
    orderBy: { analyzedAt: "desc" },
  });
  if (!row || row.workspaceId !== input.workspaceId) return null;
  if (row.method !== "HUMAN" && row.method !== "VISION") return null;
  return {
    workspaceId: row.workspaceId,
    emailAttachmentId: row.emailAttachmentId,
    relevance: row.relevance,
    noiseReason: row.noiseReason,
    confidence: row.confidence,
    method: row.method,
    evidence: row.evidence,
  };
}

async function saveRelevance(prisma: PrismaClient, row: InlineImageRelevanceSave): Promise<void> {
  const data = {
    relevance: row.decision.relevance,
    noiseReason: row.decision.noiseReason,
    confidence: row.decision.confidence,
    method: row.decision.method,
    evidence: row.decision.evidence,
    contentChecksum: row.contentChecksum,
    sourceAttachmentId: row.decision.sourceAttachmentId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    analyzedAt: new Date(),
  };
  await prisma.inlineImageRelevanceClassification.upsert({
    where: {
      workspaceId_emailAttachmentId_analyzerVersion: {
        workspaceId: row.workspaceId,
        emailAttachmentId: row.emailAttachmentId,
        analyzerVersion: row.decision.analyzerVersion,
      },
    },
    create: {
      workspaceId: row.workspaceId,
      emailAttachmentId: row.emailAttachmentId,
      analyzerVersion: row.decision.analyzerVersion,
      ...data,
    },
    update: data,
  });
}

function toResult(
  workspaceId: string,
  stats: InlineImageRelevanceBatchResult,
  continued: boolean
): InlineImageRelevanceJobResult {
  return {
    workspaceId,
    analyzed: stats.analyzed,
    reused: stats.reused,
    failed: stats.failed,
    unsupported: stats.unsupported,
    remaining: stats.remaining,
    deterministic: stats.deterministic,
    hashHuman: stats.hashHuman,
    hashModel: stats.hashModel,
    vision: stats.vision,
    uncertain: stats.uncertain,
    relevant: stats.relevant,
    noise: stats.noise,
    visionCalls: stats.visionCalls,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    continued,
  };
}
