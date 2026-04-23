-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN "isImportant" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailMessage" ADD COLUMN "isTrashed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailMessage" ADD COLUMN "isSpam" BOOLEAN NOT NULL DEFAULT false;

-- Backfill important from Gmail IMPORTANT label
UPDATE "EmailMessage" SET "isImportant" = true
  WHERE "labelIds" @> ARRAY['IMPORTANT']
     OR "labelIds" @> ARRAY['important'];

-- Partial indexes for flag-based queries
CREATE INDEX "EmailMessage_isImportant_idx" ON "EmailMessage"("isImportant") WHERE "isImportant" = true;
CREATE INDEX "EmailMessage_isTrashed_idx" ON "EmailMessage"("isTrashed") WHERE "isTrashed" = true;
CREATE INDEX "EmailMessage_isSpam_idx" ON "EmailMessage"("isSpam") WHERE "isSpam" = true;
