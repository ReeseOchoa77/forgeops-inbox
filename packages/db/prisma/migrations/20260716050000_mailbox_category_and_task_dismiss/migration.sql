-- MailboxCategory enum
CREATE TYPE "MailboxCategory" AS ENUM ('BUSINESS', 'PERSONAL', 'SPAM', 'TRASH');

-- EmailMessage: add mailboxCategory and trash tracking
ALTER TABLE "EmailMessage" ADD COLUMN "mailboxCategory" "MailboxCategory" NOT NULL DEFAULT 'BUSINESS';
ALTER TABLE "EmailMessage" ADD COLUMN "trashedAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN "trashedBy" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN "previousCategory" "MailboxCategory";

-- Backfill from existing flags
UPDATE "EmailMessage" SET "mailboxCategory" = 'TRASH' WHERE "isTrashed" = true;
UPDATE "EmailMessage" SET "mailboxCategory" = 'SPAM' WHERE "isSpam" = true AND "isTrashed" = false;
UPDATE "EmailMessage" SET "mailboxCategory" = 'PERSONAL'
  WHERE "isTrashed" = false AND "isSpam" = false
    AND EXISTS (
      SELECT 1 FROM "Classification" c
      WHERE c."messageId" = "EmailMessage"."id"
        AND c."businessCategory" = 'NON_BUSINESS'
    );

-- Index for category-based queries
CREATE INDEX "EmailMessage_mailboxCategory_idx" ON "EmailMessage"("workspaceId", "mailboxCategory", "receivedAt" DESC);

-- Task: add soft-delete/dismiss fields
ALTER TABLE "Task" ADD COLUMN "dismissedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "dismissedBy" TEXT;
ALTER TABLE "Task" ADD COLUMN "dismissalReason" TEXT;
