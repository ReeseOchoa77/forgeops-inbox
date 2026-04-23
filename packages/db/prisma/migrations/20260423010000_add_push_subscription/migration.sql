-- AlterTable
ALTER TABLE "InboxConnection" ADD COLUMN "pushSubscriptionId" TEXT;
ALTER TABLE "InboxConnection" ADD COLUMN "pushExpiresAt" TIMESTAMP(3);
