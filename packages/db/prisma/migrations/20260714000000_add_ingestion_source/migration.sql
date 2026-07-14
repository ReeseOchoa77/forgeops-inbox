-- CreateEnum
CREATE TYPE "IngestionSource" AS ENUM ('NATIVE', 'N8N');

-- AlterTable
ALTER TABLE "InboxConnection" ADD COLUMN "ingestionSource" "IngestionSource" NOT NULL DEFAULT 'NATIVE';

-- Index
CREATE INDEX "InboxConnection_ingestionSource_idx" ON "InboxConnection"("workspaceId", "ingestionSource");
