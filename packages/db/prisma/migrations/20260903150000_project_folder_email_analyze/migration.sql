-- Verified project-folder email analysis provenance + run progress.
ALTER TYPE "JobAssignmentSource" ADD VALUE IF NOT EXISTS 'VERIFIED_PROJECT_FOLDER';

CREATE TYPE "ProjectFolderAnalyzeStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE IF NOT EXISTS "ProjectFolderEmailAnalyzeRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "inboxConnectionId" TEXT NOT NULL,
  "status" "ProjectFolderAnalyzeStatus" NOT NULL DEFAULT 'PENDING',
  "folderIds" JSONB NOT NULL,
  "progress" JSONB NOT NULL DEFAULT '{}',
  "errorMessage" TEXT,
  "initiatedByUserId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectFolderEmailAnalyzeRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectFolderEmailAnalyzeRun_workspaceId_createdAt_idx"
  ON "ProjectFolderEmailAnalyzeRun"("workspaceId", "createdAt");

CREATE INDEX IF NOT EXISTS "ProjectFolderEmailAnalyzeRun_workspaceId_inboxConnectionId_status_idx"
  ON "ProjectFolderEmailAnalyzeRun"("workspaceId", "inboxConnectionId", "status");

ALTER TABLE "ProjectFolderEmailAnalyzeRun"
  ADD CONSTRAINT "ProjectFolderEmailAnalyzeRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
