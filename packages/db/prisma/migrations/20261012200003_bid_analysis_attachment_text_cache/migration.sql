-- CreateEnum
CREATE TYPE "AttachmentTextExtractStatus" AS ENUM ('NONE', 'READY', 'TEXT_UNAVAILABLE', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "EmailAttachment" ADD COLUMN     "extractedText" TEXT,
ADD COLUMN     "extractedTextChars" INTEGER,
ADD COLUMN     "textExtractError" TEXT,
ADD COLUMN     "textExtractStatus" "AttachmentTextExtractStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "textExtractedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EmailAttachment_workspaceId_textExtractStatus_idx" ON "EmailAttachment"("workspaceId", "textExtractStatus");
