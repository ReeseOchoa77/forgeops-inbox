-- Bidding Folder Analysis discovery index + scan range on BidAnalysisRun.

ALTER TABLE "BidAnalysisRun" ADD COLUMN "scanRangePreset" TEXT NOT NULL DEFAULT '90d';
ALTER TABLE "BidAnalysisRun" ADD COLUMN "scanSinceAt" TIMESTAMP(3);
ALTER TABLE "BidAnalysisRun" ADD COLUMN "scanUntilAt" TIMESTAMP(3);

CREATE TYPE "BidFolderDiscoveryRole" AS ENUM ('BID_INVITE', 'QUOTE');

CREATE TABLE "BidFolderDiscoveryEmail" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxConnectionId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "role" "BidFolderDiscoveryRole" NOT NULL,
    "lastSeenRunId" TEXT,
    "firstDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidFolderDiscoveryEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BidFolderDiscoveryEmail_workspaceId_inboxConnectionId_emailMessageId_key" ON "BidFolderDiscoveryEmail"("workspaceId", "inboxConnectionId", "emailMessageId");
CREATE INDEX "BidFolderDiscoveryEmail_workspaceId_inboxConnectionId_role_lastSeenAt_idx" ON "BidFolderDiscoveryEmail"("workspaceId", "inboxConnectionId", "role", "lastSeenAt");
CREATE INDEX "BidFolderDiscoveryEmail_emailMessageId_idx" ON "BidFolderDiscoveryEmail"("emailMessageId");
CREATE INDEX "BidFolderDiscoveryEmail_workspaceId_inboxConnectionId_role_idx" ON "BidFolderDiscoveryEmail"("workspaceId", "inboxConnectionId", "role");

ALTER TABLE "BidFolderDiscoveryEmail" ADD CONSTRAINT "BidFolderDiscoveryEmail_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
