CREATE TYPE "FolderStatus" AS ENUM ('DISCOVERED', 'APPROVED', 'IGNORED');

CREATE TABLE "DiscoveredFolder" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" "InboxProvider" NOT NULL DEFAULT 'OUTLOOK',
  "mailboxEmail" TEXT NOT NULL,
  "providerFolderId" TEXT NOT NULL,
  "parentProviderFolderId" TEXT,
  "folderPath" TEXT,
  "rawFolderName" TEXT NOT NULL,
  "normalizedFolderName" TEXT NOT NULL,
  "detectedJobNumber" TEXT,
  "matchedJobId" TEXT,
  "status" "FolderStatus" NOT NULL DEFAULT 'DISCOVERED',
  "childFolderCount" INTEGER NOT NULL DEFAULT 0,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscoveredFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DiscoveredFolder" ADD CONSTRAINT "DiscoveredFolder_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "DiscoveredFolder" ADD CONSTRAINT "DiscoveredFolder_job_fkey"
  FOREIGN KEY ("workspaceId","matchedJobId") REFERENCES "Job"("workspaceId","id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "DiscoveredFolder_workspaceId_providerFolderId_key"
  ON "DiscoveredFolder"("workspaceId", "providerFolderId");
CREATE INDEX "DiscoveredFolder_status_idx" ON "DiscoveredFolder"("workspaceId", "status");
CREATE INDEX "DiscoveredFolder_normalizedFolderName_idx" ON "DiscoveredFolder"("workspaceId", "normalizedFolderName");
CREATE INDEX "DiscoveredFolder_matchedJobId_idx" ON "DiscoveredFolder"("matchedJobId");

CREATE TABLE "JobFolderRoot" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "rootName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobFolderRoot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "JobFolderRoot" ADD CONSTRAINT "JobFolderRoot_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "JobFolderRoot_workspaceId_normalizedName_key"
  ON "JobFolderRoot"("workspaceId", "normalizedName");
CREATE INDEX "JobFolderRoot_active_idx" ON "JobFolderRoot"("workspaceId", "active");
