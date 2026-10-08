-- Platform Admin / shared-mailbox: OAuth identity may differ from ingested mailbox.
ALTER TABLE "InboxConnection" ADD COLUMN IF NOT EXISTS "delegatedMailboxAccess" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboxConnection" ADD COLUMN IF NOT EXISTS "oauthAccountEmail" TEXT;
