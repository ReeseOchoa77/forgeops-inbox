-- CreateTable
CREATE TABLE "JobIdentityProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "profileVersion" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "modelIdentifier" TEXT,
    "promptVersion" TEXT,
    "analysisStatus" TEXT NOT NULL,
    "profileJson" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobIdentityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobIdentityProfile_workspaceId_jobId_idx" ON "JobIdentityProfile"("workspaceId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobIdentityProfile_workspaceId_jobId_profileVersion_key" ON "JobIdentityProfile"("workspaceId", "jobId", "profileVersion");

-- AddForeignKey
ALTER TABLE "JobIdentityProfile" ADD CONSTRAINT "JobIdentityProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIdentityProfile" ADD CONSTRAINT "JobIdentityProfile_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
