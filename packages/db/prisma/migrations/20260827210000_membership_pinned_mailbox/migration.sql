-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "pinnedInboxConnectionId" TEXT;

-- CreateIndex
CREATE INDEX "Membership_pinnedInboxConnectionId_idx" ON "Membership"("pinnedInboxConnectionId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_pinnedInboxConnectionId_fkey" FOREIGN KEY ("pinnedInboxConnectionId") REFERENCES "InboxConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
