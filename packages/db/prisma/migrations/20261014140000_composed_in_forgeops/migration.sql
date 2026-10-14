-- ForgeOps compose/send provenance (Phase 5).
-- Distinguishes emails sent through ForgeOps from Outlook-direct Sent Items imports.

ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "composedInForgeOps" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "EmailMessage_workspaceId_inboxConnectionId_composedInForgeOps_sentAt_idx"
  ON "EmailMessage"("workspaceId", "inboxConnectionId", "composedInForgeOps", "sentAt");
