-- Provenance for human corrections of inline-image relevance (non-destructive).
ALTER TABLE "InlineImageRelevanceClassification"
  ADD COLUMN "priorRelevance" "InlineImageRelevance",
  ADD COLUMN "priorNoiseReason" "InlineImageNoiseReason",
  ADD COLUMN "priorMethod" "InlineImageRelevanceMethod",
  ADD COLUMN "priorConfidence" DOUBLE PRECISION,
  ADD COLUMN "priorEvidence" TEXT,
  ADD COLUMN "correctedAt" TIMESTAMP(3),
  ADD COLUMN "correctedByUserId" TEXT;

CREATE INDEX "InlineImageRelevanceClassification_workspaceId_method_correctedAt_idx"
  ON "InlineImageRelevanceClassification"("workspaceId", "method", "correctedAt");
