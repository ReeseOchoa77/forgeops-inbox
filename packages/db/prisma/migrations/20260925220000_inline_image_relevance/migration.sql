-- Metadata about inline images. EmailAttachment rows and object bytes are unchanged.
CREATE TYPE "InlineImageRelevance" AS ENUM ('RELEVANT', 'NOISE', 'UNCERTAIN');

CREATE TYPE "InlineImageNoiseReason" AS ENUM (
  'LOGO',
  'ICON',
  'SIGNATURE_GRAPHIC',
  'DECORATIVE',
  'TRACKING_PIXEL',
  'BADGE',
  'REPEATED_BRANDING',
  'OTHER_NOISE'
);

CREATE TYPE "InlineImageRelevanceMethod" AS ENUM (
  'DETERMINISTIC',
  'VISION',
  'HUMAN',
  'HUMAN_CONFIRMED_HASH_MATCH',
  'MODEL_HASH_MATCH'
);

CREATE TABLE "InlineImageRelevanceClassification" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "emailAttachmentId" TEXT NOT NULL,
  "relevance" "InlineImageRelevance" NOT NULL,
  "noiseReason" "InlineImageNoiseReason",
  "confidence" DOUBLE PRECISION NOT NULL,
  "method" "InlineImageRelevanceMethod" NOT NULL,
  "analyzerVersion" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "contentChecksum" TEXT,
  "sourceAttachmentId" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InlineImageRelevanceClassification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InlineImageRelevanceClassification_workspaceId_emailAttachmentId_analyzerVersion_key"
  ON "InlineImageRelevanceClassification"("workspaceId", "emailAttachmentId", "analyzerVersion");

CREATE INDEX "InlineImageRelevanceClassification_workspaceId_contentChecksum_analyzerVersion_idx"
  ON "InlineImageRelevanceClassification"("workspaceId", "contentChecksum", "analyzerVersion");

CREATE INDEX "InlineImageRelevanceClassification_workspaceId_relevance_idx"
  ON "InlineImageRelevanceClassification"("workspaceId", "relevance");

ALTER TABLE "InlineImageRelevanceClassification"
  ADD CONSTRAINT "InlineImageRelevanceClassification_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InlineImageRelevanceClassification"
  ADD CONSTRAINT "InlineImageRelevanceClassification_emailAttachmentId_fkey"
  FOREIGN KEY ("emailAttachmentId") REFERENCES "EmailAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
