-- CreateTable
CREATE TABLE "JobMatcherEvalGroundTruthCorrection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "originalGroundTruthJobId" TEXT NOT NULL,
    "correctedGroundTruthJobId" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedByUserId" TEXT,
    "sourceEvaluationRunId" TEXT,
    "sourceModelPolicy" TEXT,
    "note" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMatcherEvalGroundTruthCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobMatcherEvalGroundTruthCorrection_workspaceId_emailMessageId_idx" ON "JobMatcherEvalGroundTruthCorrection"("workspaceId", "emailMessageId");

-- CreateIndex
CREATE INDEX "JobMatcherEvalGroundTruthCorrection_workspaceId_verificationStatus_idx" ON "JobMatcherEvalGroundTruthCorrection"("workspaceId", "verificationStatus");

-- CreateIndex
CREATE INDEX "JobMatcherEvalGroundTruthCorrection_workspaceId_sourceEvaluationRunId_idx" ON "JobMatcherEvalGroundTruthCorrection"("workspaceId", "sourceEvaluationRunId");

-- AddForeignKey
ALTER TABLE "JobMatcherEvalGroundTruthCorrection" ADD CONSTRAINT "JobMatcherEvalGroundTruthCorrection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatcherEvalGroundTruthCorrection" ADD CONSTRAINT "JobMatcherEvalGroundTruthCorrection_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatcherEvalGroundTruthCorrection" ADD CONSTRAINT "JobMatcherEvalGroundTruthCorrection_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
