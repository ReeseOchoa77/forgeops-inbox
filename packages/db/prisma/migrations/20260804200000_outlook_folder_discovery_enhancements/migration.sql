-- AlterEnum: Add MATCHED and ARCHIVED to FolderStatus
ALTER TYPE "FolderStatus" ADD VALUE 'MATCHED';
ALTER TYPE "FolderStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum: Add OUTLOOK_FOLDER to AliasSource
ALTER TYPE "AliasSource" ADD VALUE 'OUTLOOK_FOLDER';

-- AlterTable: Add new columns to DiscoveredFolder
ALTER TABLE "DiscoveredFolder" ADD COLUMN "detectedJobName" TEXT;
ALTER TABLE "DiscoveredFolder" ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DiscoveredFolder" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "DiscoveredFolder" ADD COLUMN "approvedByUserId" TEXT;
ALTER TABLE "DiscoveredFolder" ADD COLUMN "ignoredAt" TIMESTAMP(3);
ALTER TABLE "DiscoveredFolder" ADD COLUMN "ignoredByUserId" TEXT;

-- AlterTable: Make folderPath non-nullable (set default for existing nulls first)
UPDATE "DiscoveredFolder" SET "folderPath" = "rawFolderName" WHERE "folderPath" IS NULL;
ALTER TABLE "DiscoveredFolder" ALTER COLUMN "folderPath" SET NOT NULL;

-- DropIndex: Drop the old unique constraint
DROP INDEX IF EXISTS "DiscoveredFolder_workspaceId_providerFolderId_key";

-- CreateIndex: Add new unique constraint including mailboxEmail
CREATE UNIQUE INDEX "DiscoveredFolder_workspaceId_mailboxEmail_providerFolderId_key" ON "DiscoveredFolder"("workspaceId", "mailboxEmail", "providerFolderId");

-- AlterTable: Add new columns to JobFolderRoot
ALTER TABLE "JobFolderRoot" ADD COLUMN "mailboxEmail" TEXT;
ALTER TABLE "JobFolderRoot" ADD COLUMN "provider" "InboxProvider" NOT NULL DEFAULT 'OUTLOOK';
ALTER TABLE "JobFolderRoot" ADD COLUMN "providerFolderId" TEXT;
ALTER TABLE "JobFolderRoot" ADD COLUMN "folderPath" TEXT;
ALTER TABLE "JobFolderRoot" ADD COLUMN "folderName" TEXT;
ALTER TABLE "JobFolderRoot" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "JobFolderRoot" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex: Index for isActive
CREATE INDEX "JobFolderRoot_workspaceId_isActive_idx" ON "JobFolderRoot"("workspaceId", "isActive");
