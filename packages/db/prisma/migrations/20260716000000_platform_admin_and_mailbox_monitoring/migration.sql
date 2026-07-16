-- User: add isPlatformAdmin flag
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- InboxConnection: add monitoring fields
ALTER TABLE "InboxConnection" ADD COLUMN "lastReceivedAt" TIMESTAMP(3);
ALTER TABLE "InboxConnection" ADD COLUMN "lastProcessedAt" TIMESTAMP(3);
ALTER TABLE "InboxConnection" ADD COLUMN "lastErrorMessage" TEXT;

-- Index for n8n mailbox lookup (resolve workspace from provider+email)
CREATE INDEX "InboxConnection_provider_email_ingestionSource_idx"
  ON "InboxConnection"("provider", "email", "ingestionSource");

-- Set Reese as platform admin
UPDATE "User" SET "isPlatformAdmin" = true WHERE "email" = '24rochoa@gmail.com';
