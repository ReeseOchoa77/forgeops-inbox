-- Per-mailbox: when true, ForgeOps Inbox trash also deletes the provider message.
ALTER TABLE "InboxConnection" ADD COLUMN IF NOT EXISTS "deleteFromProviderOnDelete" BOOLEAN NOT NULL DEFAULT false;
