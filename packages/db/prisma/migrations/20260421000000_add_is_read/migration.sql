-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN "isRead" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark all existing messages as read
UPDATE "EmailMessage" SET "isRead" = true;
