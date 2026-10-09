-- Outlook Sent Items live/historical cursors + canonical EmailMessage.direction.
-- Does not alter existing Inbox syncCursor values.

CREATE TYPE "EmailDirection" AS ENUM ('RECEIVED', 'SENT');

ALTER TABLE "InboxConnection" ADD COLUMN IF NOT EXISTS "sentSyncCursor" TEXT;

ALTER TABLE "MailboxHistoricalImport" ADD COLUMN IF NOT EXISTS "sentResumeCursor" TEXT;

ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "direction" "EmailDirection";

CREATE INDEX IF NOT EXISTS "EmailMessage_inboxConnectionId_internetMessageId_idx"
  ON "EmailMessage"("inboxConnectionId", "internetMessageId");

CREATE INDEX IF NOT EXISTS "EmailMessage_workspaceId_inboxConnectionId_direction_sentAt_idx"
  ON "EmailMessage"("workspaceId", "inboxConnectionId", "direction", "sentAt");
