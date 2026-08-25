-- Mailbox control-plane: explicit native listener settings + historical import jobs.
-- Authentication remains separate from listening/classification.

-- AlterEnum
ALTER TYPE "IngestionSource" ADD VALUE IF NOT EXISTS 'SHADOW';

-- CreateEnum
CREATE TYPE "MailboxHistoricalImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable InboxConnection: listener settings + safer default processing mode
ALTER TABLE "InboxConnection"
  ADD COLUMN IF NOT EXISTS "nativeListeningEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "listenIncoming" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "listenSent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "excludeJunk" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "excludeTrash" BOOLEAN NOT NULL DEFAULT true;

-- Preserve existing NATIVE mailboxes that already relied on automatic sync.
UPDATE "InboxConnection"
SET "nativeListeningEnabled" = true
WHERE "ingestionSource" = 'NATIVE'
  AND "status" IN ('ACTIVE', 'ERROR', 'REQUIRES_REAUTH');

-- New connections default to N8N unless explicitly switched (column default for inserts).
ALTER TABLE "InboxConnection" ALTER COLUMN "ingestionSource" SET DEFAULT 'N8N';

CREATE INDEX IF NOT EXISTS "InboxConnection_workspaceId_nativeListeningEnabled_idx"
  ON "InboxConnection"("workspaceId", "nativeListeningEnabled");

-- CreateTable
CREATE TABLE IF NOT EXISTS "MailboxHistoricalImport" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "inboxConnectionId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "status" "MailboxHistoricalImportStatus" NOT NULL DEFAULT 'PENDING',
  "requestedLimit" INTEGER NOT NULL,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "businessCount" INTEGER NOT NULL DEFAULT 0,
  "personalCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "processedProviderMessageIds" JSONB NOT NULL DEFAULT '[]',
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailboxHistoricalImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MailboxHistoricalImport_workspaceId_inboxConnectionId_createdAt_idx"
  ON "MailboxHistoricalImport"("workspaceId", "inboxConnectionId", "createdAt");

CREATE INDEX IF NOT EXISTS "MailboxHistoricalImport_inboxConnectionId_status_idx"
  ON "MailboxHistoricalImport"("inboxConnectionId", "status");

ALTER TABLE "MailboxHistoricalImport"
  DROP CONSTRAINT IF EXISTS "MailboxHistoricalImport_workspaceId_fkey";
ALTER TABLE "MailboxHistoricalImport"
  ADD CONSTRAINT "MailboxHistoricalImport_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MailboxHistoricalImport"
  DROP CONSTRAINT IF EXISTS "MailboxHistoricalImport_inboxConnectionId_fkey";
ALTER TABLE "MailboxHistoricalImport"
  ADD CONSTRAINT "MailboxHistoricalImport_inboxConnectionId_fkey"
  FOREIGN KEY ("inboxConnectionId") REFERENCES "InboxConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
