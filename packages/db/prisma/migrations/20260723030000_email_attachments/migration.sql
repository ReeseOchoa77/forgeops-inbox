CREATE TYPE "AttachmentUploadStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED');

CREATE TABLE "EmailAttachment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "emailMessageId" TEXT NOT NULL,
  "providerAttachmentId" TEXT,
  "filename" TEXT NOT NULL,
  "sanitizedFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT,
  "checksum" TEXT,
  "isInline" BOOLEAN NOT NULL DEFAULT false,
  "uploadStatus" "AttachmentUploadStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_emailMessageId_fkey"
  FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "EmailAttachment_emailMessageId_providerAttachmentId_key"
  ON "EmailAttachment"("emailMessageId", "providerAttachmentId");
CREATE UNIQUE INDEX "EmailAttachment_workspaceId_storageKey_key"
  ON "EmailAttachment"("workspaceId", "storageKey");
CREATE INDEX "EmailAttachment_workspace_email_idx"
  ON "EmailAttachment"("workspaceId", "emailMessageId");
CREATE INDEX "EmailAttachment_checksum_idx" ON "EmailAttachment"("checksum");
