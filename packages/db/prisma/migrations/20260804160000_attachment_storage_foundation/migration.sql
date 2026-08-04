-- AlterEnum: add REJECTED to AttachmentUploadStatus
ALTER TYPE "AttachmentUploadStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- AlterTable: add new columns to EmailAttachment
ALTER TABLE "EmailAttachment" ADD COLUMN IF NOT EXISTS "provider" "InboxProvider";
ALTER TABLE "EmailAttachment" ADD COLUMN IF NOT EXISTS "contentId" TEXT;

-- Drop old unique constraint and create new one that includes workspaceId
-- Use IF EXISTS to make this idempotent
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EmailAttachment_emailMessageId_providerAttachmentId_key'
  ) THEN
    ALTER TABLE "EmailAttachment"
      DROP CONSTRAINT "EmailAttachment_emailMessageId_providerAttachmentId_key";
  END IF;
END $$;

-- Create new unique constraint (idempotent via IF NOT EXISTS on index)
CREATE UNIQUE INDEX IF NOT EXISTS "EmailAttachment_workspaceId_emailMessageId_providerAttach_key"
  ON "EmailAttachment"("workspaceId", "emailMessageId", "providerAttachmentId");
