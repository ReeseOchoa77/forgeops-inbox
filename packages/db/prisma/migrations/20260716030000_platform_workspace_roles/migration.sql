-- New enums
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_ADMIN', 'STANDARD_USER');
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
CREATE TYPE "MailboxStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "IngestionMode" AS ENUM ('NATIVE', 'N8N');

-- User: add platformRole
ALTER TABLE "User" ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'STANDARD_USER';

-- Backfill: sync isPlatformAdmin → platformRole
UPDATE "User" SET "platformRole" = 'PLATFORM_ADMIN' WHERE "isPlatformAdmin" = true;

-- Seed known platform admins
UPDATE "User" SET "platformRole" = 'PLATFORM_ADMIN', "isPlatformAdmin" = true
  WHERE "email" IN ('24rochoa@gmail.com', 'reese.ochoa@neruanet.ai');

-- Membership: add workspaceRole
ALTER TABLE "Membership" ADD COLUMN "workspaceRole" "WorkspaceRole" NOT NULL DEFAULT 'VIEWER';

-- Backfill: map old Role to new WorkspaceRole
UPDATE "Membership" SET "workspaceRole" = 'OWNER' WHERE "role" IN ('OWNER', 'ADMIN');
UPDATE "Membership" SET "workspaceRole" = 'EDITOR' WHERE "role" IN ('MANAGER', 'MEMBER');
UPDATE "Membership" SET "workspaceRole" = 'VIEWER' WHERE "role" = 'VIEWER';

-- ApprovedAccess: add workspaceRole
ALTER TABLE "ApprovedAccess" ADD COLUMN "workspaceRole" "WorkspaceRole" NOT NULL DEFAULT 'VIEWER';

-- Backfill approved access
UPDATE "ApprovedAccess" SET "workspaceRole" = 'OWNER' WHERE "role" IN ('OWNER', 'ADMIN');
UPDATE "ApprovedAccess" SET "workspaceRole" = 'EDITOR' WHERE "role" IN ('MANAGER', 'MEMBER');
UPDATE "ApprovedAccess" SET "workspaceRole" = 'VIEWER' WHERE "role" = 'VIEWER';

-- Indexes
CREATE INDEX "Membership_workspaceRole_idx" ON "Membership"("workspaceId", "workspaceRole");

-- WorkspaceMailbox
CREATE TABLE "WorkspaceMailbox" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "emailAddress" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "provider" "InboxProvider" NOT NULL DEFAULT 'OUTLOOK',
  "displayName" TEXT,
  "status" "MailboxStatus" NOT NULL DEFAULT 'ACTIVE',
  "ingestionMode" "IngestionMode" NOT NULL DEFAULT 'N8N',
  "inboxConnectionId" TEXT,
  "lastMessageSeenAt" TIMESTAMP(3),
  "lastSuccessfulProcessingAt" TIMESTAMP(3),
  "lastErrorAt" TIMESTAMP(3),
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceMailbox_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WorkspaceMailbox" ADD CONSTRAINT "WorkspaceMailbox_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;

ALTER TABLE "WorkspaceMailbox" ADD CONSTRAINT "WorkspaceMailbox_inboxConnectionId_fkey"
  FOREIGN KEY ("inboxConnectionId") REFERENCES "InboxConnection"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "WorkspaceMailbox_workspaceId_normalizedEmail_key"
  ON "WorkspaceMailbox"("workspaceId", "normalizedEmail");

CREATE UNIQUE INDEX "WorkspaceMailbox_normalizedEmail_provider_key"
  ON "WorkspaceMailbox"("normalizedEmail", "provider");

CREATE INDEX "WorkspaceMailbox_status_idx" ON "WorkspaceMailbox"("workspaceId", "status");
CREATE INDEX "WorkspaceMailbox_normalizedEmail_idx" ON "WorkspaceMailbox"("normalizedEmail");
CREATE INDEX "WorkspaceMailbox_provider_normalizedEmail_idx" ON "WorkspaceMailbox"("provider", "normalizedEmail");

-- Backfill: create WorkspaceMailbox from existing N8N InboxConnections
INSERT INTO "WorkspaceMailbox" ("id", "workspaceId", "emailAddress", "normalizedEmail", "provider", "displayName", "status", "ingestionMode", "inboxConnectionId", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, "workspaceId", "email", lower("email"), "provider",
         COALESCE("displayName", "email"),
         CASE WHEN "status" = 'ACTIVE' THEN 'ACTIVE'::"MailboxStatus"
              WHEN "status" = 'PAUSED' THEN 'PAUSED'::"MailboxStatus"
              WHEN "status" = 'ERROR' THEN 'ERROR'::"MailboxStatus"
              ELSE 'DISCONNECTED'::"MailboxStatus" END,
         CASE WHEN "ingestionSource" = 'N8N' THEN 'N8N'::"IngestionMode"
              ELSE 'NATIVE'::"IngestionMode" END,
         "id", now(), now()
  FROM "InboxConnection"
  WHERE "status" != 'DISCONNECTED'
  ON CONFLICT DO NOTHING;
