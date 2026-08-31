-- CreateEnum
CREATE TYPE "ClassificationProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'CLASSIFIED', 'FAILED');

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN "classificationStatus" "ClassificationProcessingStatus",
ADD COLUMN "classificationLastAttemptAt" TIMESTAMP(3),
ADD COLUMN "classificationAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "classificationError" TEXT;

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_inboxConnectionId_classificationStatus_createdAt_idx" ON "EmailMessage"("workspaceId", "inboxConnectionId", "classificationStatus", "createdAt");
