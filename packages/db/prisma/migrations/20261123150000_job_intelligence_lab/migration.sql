-- CreateTable
CREATE TABLE "WorkspaceIntelligenceConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productionIntelligenceModelId" TEXT NOT NULL DEFAULT 'job-intel-extract-v1',
    "documentedMatcherPolicyId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceIntelligenceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobIntelligenceLabRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "associationMode" TEXT NOT NULL,
    "matcherModelId" TEXT NOT NULL,
    "matcherModelVersion" TEXT,
    "intelligenceModelId" TEXT NOT NULL,
    "intelligenceModelVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "configHash" TEXT,
    "associationSnapshot" JSONB NOT NULL DEFAULT '[]',
    "sourceEmailIds" JSONB NOT NULL DEFAULT '[]',
    "sourceAttachmentIds" JSONB NOT NULL DEFAULT '[]',
    "resultJson" JSONB NOT NULL DEFAULT '{}',
    "diagnostics" JSONB,
    "usage" JSONB,
    "errorMessage" TEXT,
    "initiatedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobIntelligenceLabRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceIntelligenceConfig_workspaceId_key" ON "WorkspaceIntelligenceConfig"("workspaceId");
CREATE INDEX "JobIntelligenceLabRun_workspaceId_createdAt_idx" ON "JobIntelligenceLabRun"("workspaceId", "createdAt");
CREATE INDEX "JobIntelligenceLabRun_workspaceId_jobId_createdAt_idx" ON "JobIntelligenceLabRun"("workspaceId", "jobId", "createdAt");
CREATE INDEX "JobIntelligenceLabRun_workspaceId_status_idx" ON "JobIntelligenceLabRun"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "WorkspaceIntelligenceConfig" ADD CONSTRAINT "WorkspaceIntelligenceConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobIntelligenceLabRun" ADD CONSTRAINT "JobIntelligenceLabRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobIntelligenceLabRun" ADD CONSTRAINT "JobIntelligenceLabRun_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
