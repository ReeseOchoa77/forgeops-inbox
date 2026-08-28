-- AlterTable
ALTER TABLE "InboxConnection" ADD COLUMN IF NOT EXISTS "inboxClearedAt" TIMESTAMP(3);
