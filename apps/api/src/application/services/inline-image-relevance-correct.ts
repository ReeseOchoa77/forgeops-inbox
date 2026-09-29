import type { PrismaClient } from "@prisma/client";
import {
  INLINE_IMAGE_NOISE_REASONS,
  INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
  type InlineImageNoiseReason,
  type InlineImageRelevance,
} from "@forgeops/ai";

export type HumanRelevanceCorrectionInput = {
  workspaceId: string;
  emailAttachmentId: string;
  relevance: "RELEVANT" | "NOISE";
  noiseReason?: InlineImageNoiseReason | null;
  userId: string;
};

export type InlineImageRelevanceDto = {
  emailAttachmentId: string;
  relevance: InlineImageRelevance;
  noiseReason: InlineImageNoiseReason | null;
  confidence: number;
  method: string;
  analyzerVersion: string;
  evidence: string;
  analyzedAt: string;
  correctedAt: string | null;
  priorRelevance: InlineImageRelevance | null;
  priorMethod: string | null;
};

export class InlineImageRelevanceCorrectError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404
  ) {
    super(message);
    this.name = "InlineImageRelevanceCorrectError";
  }
}

const NOISE_SET = new Set<string>(INLINE_IMAGE_NOISE_REASONS);

function present(row: {
  emailAttachmentId: string;
  relevance: InlineImageRelevance;
  noiseReason: InlineImageNoiseReason | null;
  confidence: number;
  method: string;
  analyzerVersion: string;
  evidence: string;
  analyzedAt: Date;
  correctedAt: Date | null;
  priorRelevance: InlineImageRelevance | null;
  priorMethod: string | null;
}): InlineImageRelevanceDto {
  return {
    emailAttachmentId: row.emailAttachmentId,
    relevance: row.relevance,
    noiseReason: row.noiseReason,
    confidence: row.confidence,
    method: row.method,
    analyzerVersion: row.analyzerVersion,
    evidence: row.evidence,
    analyzedAt: row.analyzedAt.toISOString(),
    correctedAt: row.correctedAt?.toISOString() ?? null,
    priorRelevance: row.priorRelevance,
    priorMethod: row.priorMethod,
  };
}

/**
 * Human correction becomes the authoritative InlineImageRelevanceClassification row.
 * Does not modify EmailAttachment bytes, storage, or visibility.
 * Exact SHA-256 reuse of this HUMAN row applies on future analysis runs only.
 */
export async function correctInlineImageRelevance(
  prisma: PrismaClient,
  input: HumanRelevanceCorrectionInput
): Promise<InlineImageRelevanceDto> {
  if (input.relevance === "NOISE") {
    if (!input.noiseReason || !NOISE_SET.has(input.noiseReason)) {
      throw new InlineImageRelevanceCorrectError(
        "noiseReason is required when marking irrelevant",
        400
      );
    }
  }

  const attachment = await prisma.emailAttachment.findFirst({
    where: {
      id: input.emailAttachmentId,
      workspaceId: input.workspaceId,
    },
    select: {
      id: true,
      workspaceId: true,
      mimeType: true,
      checksum: true,
      uploadStatus: true,
    },
  });
  if (!attachment || attachment.workspaceId !== input.workspaceId) {
    throw new InlineImageRelevanceCorrectError("Attachment not found", 404);
  }
  if (attachment.uploadStatus !== "UPLOADED") {
    throw new InlineImageRelevanceCorrectError("Attachment is not available", 400);
  }
  if (!attachment.mimeType.toLowerCase().startsWith("image/")) {
    throw new InlineImageRelevanceCorrectError("Only images can be corrected", 400);
  }

  const existing = await prisma.inlineImageRelevanceClassification.findUnique({
    where: {
      workspaceId_emailAttachmentId_analyzerVersion: {
        workspaceId: input.workspaceId,
        emailAttachmentId: input.emailAttachmentId,
        analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
      },
    },
  });

  const now = new Date();
  const noiseReason = input.relevance === "NOISE" ? input.noiseReason! : null;
  const keepPrior =
    existing &&
    existing.method !== "HUMAN" &&
    existing.priorRelevance == null
      ? {
          priorRelevance: existing.relevance,
          priorNoiseReason: existing.noiseReason,
          priorMethod: existing.method,
          priorConfidence: existing.confidence,
          priorEvidence: existing.evidence,
        }
      : existing
        ? {
            priorRelevance: existing.priorRelevance,
            priorNoiseReason: existing.priorNoiseReason,
            priorMethod: existing.priorMethod,
            priorConfidence: existing.priorConfidence,
            priorEvidence: existing.priorEvidence,
          }
        : {
            priorRelevance: null,
            priorNoiseReason: null,
            priorMethod: null,
            priorConfidence: null,
            priorEvidence: null,
          };

  const data = {
    relevance: input.relevance,
    noiseReason,
    confidence: 1,
    method: "HUMAN" as const,
    evidence: "human review",
    contentChecksum: attachment.checksum,
    sourceAttachmentId: null,
    inputTokens: null,
    outputTokens: null,
    analyzedAt: now,
    correctedAt: now,
    correctedByUserId: input.userId,
    ...keepPrior,
  };

  const row = await prisma.inlineImageRelevanceClassification.upsert({
    where: {
      workspaceId_emailAttachmentId_analyzerVersion: {
        workspaceId: input.workspaceId,
        emailAttachmentId: input.emailAttachmentId,
        analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      emailAttachmentId: input.emailAttachmentId,
      analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
      ...data,
    },
    update: data,
  });

  return present(row);
}

export function serializeRelevanceRow(row: {
  emailAttachmentId: string;
  relevance: InlineImageRelevance;
  noiseReason: InlineImageNoiseReason | null;
  confidence: number;
  method: string;
  analyzerVersion: string;
  evidence: string;
  analyzedAt: Date;
  correctedAt: Date | null;
  priorRelevance: InlineImageRelevance | null;
  priorMethod: string | null;
}): InlineImageRelevanceDto {
  return present(row);
}
