-- CreateTable
CREATE TABLE "JobMatcherEvalRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "datasetFingerprint" TEXT,
    "experimentRevision" TEXT,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMatcherEvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMatcherEvalExclusion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "evaluationRunId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "excludedByUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMatcherEvalExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobMatcherEvalRun_workspaceId_createdAt_idx" ON "JobMatcherEvalRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "JobMatcherEvalExclusion_workspaceId_evaluationRunId_idx" ON "JobMatcherEvalExclusion"("workspaceId", "evaluationRunId");

-- CreateIndex
CREATE INDEX "JobMatcherEvalExclusion_workspaceId_emailMessageId_idx" ON "JobMatcherEvalExclusion"("workspaceId", "emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "JobMatcherEvalExclusion_evaluationRunId_emailMessageId_key" ON "JobMatcherEvalExclusion"("evaluationRunId", "emailMessageId");

-- AddForeignKey
ALTER TABLE "JobMatcherEvalRun" ADD CONSTRAINT "JobMatcherEvalRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatcherEvalRun" ADD CONSTRAINT "JobMatcherEvalRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatcherEvalExclusion" ADD CONSTRAINT "JobMatcherEvalExclusion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatcherEvalExclusion" ADD CONSTRAINT "JobMatcherEvalExclusion_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "JobMatcherEvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatcherEvalExclusion" ADD CONSTRAINT "JobMatcherEvalExclusion_excludedByUserId_fkey" FOREIGN KEY ("excludedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
