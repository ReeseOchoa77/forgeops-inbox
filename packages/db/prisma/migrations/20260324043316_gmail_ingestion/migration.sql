-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "attachmentMetadata" JSONB,
ADD COLUMN     "historyId" TEXT,
ADD COLUMN     "labelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_inboxConnectionId_receivedAt_idx" ON "EmailMessage"("workspaceId", "inboxConnectionId", "receivedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_historyId_idx" ON "EmailMessage"("workspaceId", "historyId");
