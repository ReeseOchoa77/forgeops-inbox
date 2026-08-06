-- DropIndex
DROP INDEX "EmailAttachment_emailMessageId_providerAttachmentId_key";

-- CreateIndex
CREATE INDEX "Classification_messageId_businessCategory_businessTypeKey_idx" ON "Classification"("messageId", "businessCategory", "businessTypeKey");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_inboxConnectionId_isTrashed_isArch_idx" ON "EmailMessage"("workspaceId", "inboxConnectionId", "isTrashed", "isArchived", "receivedAt");

-- RenameIndex
ALTER INDEX "EmailAttachment_workspaceId_emailMessageId_providerAttach_key" RENAME TO "EmailAttachment_workspaceId_emailMessageId_providerAttachme_key";
