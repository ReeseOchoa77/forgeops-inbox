-- CreateEnum
CREATE TYPE "JobIntelligenceRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobIntelligenceRunKind" AS ENUM ('HISTORICAL_BACKFILL', 'INCREMENTAL', 'SUMMARY_ONLY', 'REPROCESS');

-- CreateEnum
CREATE TYPE "JobIntelligenceEventCategory" AS ENUM ('FINANCIAL', 'SCOPE', 'SCHEDULE', 'RFI_TECHNICAL', 'RISK_CHANGE', 'CONTACT', 'DECISION_COMMITMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "JobIntelligenceEventStatus" AS ENUM ('PROPOSED', 'REQUESTED', 'TENTATIVE', 'CONFIRMED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELED', 'SUPERSEDED', 'OPEN', 'RESOLVED', 'DISPUTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobIntelligenceVerificationStatus" AS ENUM ('AI_EXTRACTED', 'HUMAN_VERIFIED', 'HUMAN_CORRECTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "JobIntelligenceFinancialKind" AS ENUM ('ESTIMATE', 'QUOTE', 'PROPOSAL', 'REQUESTED', 'APPROVED', 'REJECTED', 'INVOICED', 'PAID', 'DISPUTED', 'CREDIT', 'BACKCHARGE', 'CHANGE_ORDER', 'OTHER', 'NONE');

-- CreateEnum
CREATE TYPE "JobIntelligenceEligibilityTier" AS ENUM ('AUTHORITATIVE', 'HIGH_CONFIDENCE_AI', 'REVIEW_ONLY', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "JobIntelligenceSummaryStatus" AS ENUM ('STALE', 'CURRENT', 'GENERATING', 'FAILED');

-- CreateEnum
CREATE TYPE "JobIntelligenceEmailProcessStatus" AS ENUM ('PROCESSED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "JobIntelligenceAnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "JobIntelligenceRunStatus" NOT NULL DEFAULT 'PENDING',
    "kind" "JobIntelligenceRunKind" NOT NULL,
    "extractionModelVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "initiatedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobIntelligenceAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobIntelligenceEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "analysisRunId" TEXT,
    "category" "JobIntelligenceEventCategory" NOT NULL,
    "subtype" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "eventDatePrecision" TEXT,
    "status" "JobIntelligenceEventStatus" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION,
    "financialKind" "JobIntelligenceFinancialKind" NOT NULL DEFAULT 'NONE',
    "amountDecimal" DECIMAL(14,2),
    "currency" TEXT,
    "parties" JSONB,
    "fabricationItems" JSONB,
    "metadata" JSONB,
    "verificationStatus" "JobIntelligenceVerificationStatus" NOT NULL DEFAULT 'AI_EXTRACTED',
    "humanCorrection" JSONB,
    "contentFingerprint" TEXT NOT NULL,
    "supersededByEventId" TEXT,
    "extractionModelVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobIntelligenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobIntelligenceEventSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "emailAttachmentId" TEXT,
    "excerpt" TEXT NOT NULL,
    "excerptHash" TEXT NOT NULL,
    "sourceRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobIntelligenceEventSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobIntelligenceFact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "eventId" TEXT,
    "factKey" TEXT NOT NULL,
    "factValue" TEXT NOT NULL,
    "valueType" TEXT,
    "status" "JobIntelligenceEventStatus" NOT NULL DEFAULT 'UNKNOWN',
    "verificationStatus" "JobIntelligenceVerificationStatus" NOT NULL DEFAULT 'AI_EXTRACTED',
    "evidenceEventIds" JSONB,
    "metadata" JSONB,
    "contentFingerprint" TEXT NOT NULL,
    "supersededByFactId" TEXT,
    "humanCorrection" JSONB,
    "extractionModelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobIntelligenceFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobIntelligenceSummary" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "JobIntelligenceSummaryStatus" NOT NULL DEFAULT 'GENERATING',
    "sections" JSONB NOT NULL DEFAULT '{}',
    "modelVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "basedOnEventCount" INTEGER NOT NULL DEFAULT 0,
    "basedOnRunId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobIntelligenceSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobIntelligenceEmailState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "eligibilityTier" "JobIntelligenceEligibilityTier" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "lastContentHash" TEXT,
    "lastExtractionModelVersion" TEXT,
    "lastRunId" TEXT,
    "skipReason" TEXT,
    "status" "JobIntelligenceEmailProcessStatus" NOT NULL DEFAULT 'SKIPPED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobIntelligenceEmailState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobIntelligenceAnalysisRun_workspaceId_jobId_createdAt_idx" ON "JobIntelligenceAnalysisRun"("workspaceId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobIntelligenceAnalysisRun_workspaceId_status_idx" ON "JobIntelligenceAnalysisRun"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "JobIntelligenceEvent_workspaceId_jobId_category_idx" ON "JobIntelligenceEvent"("workspaceId", "jobId", "category");

-- CreateIndex
CREATE INDEX "JobIntelligenceEvent_workspaceId_jobId_status_idx" ON "JobIntelligenceEvent"("workspaceId", "jobId", "status");

-- CreateIndex
CREATE INDEX "JobIntelligenceEvent_workspaceId_jobId_eventDate_idx" ON "JobIntelligenceEvent"("workspaceId", "jobId", "eventDate");

-- CreateIndex
CREATE INDEX "JobIntelligenceEvent_workspaceId_jobId_verificationStatus_idx" ON "JobIntelligenceEvent"("workspaceId", "jobId", "verificationStatus");

-- CreateIndex
CREATE INDEX "JobIntelligenceEvent_workspaceId_analysisRunId_idx" ON "JobIntelligenceEvent"("workspaceId", "analysisRunId");

-- CreateIndex
CREATE UNIQUE INDEX "JobIntelligenceEvent_workspaceId_jobId_contentFingerprint_key" ON "JobIntelligenceEvent"("workspaceId", "jobId", "contentFingerprint");

-- CreateIndex
CREATE INDEX "JobIntelligenceEventSource_workspaceId_emailMessageId_idx" ON "JobIntelligenceEventSource"("workspaceId", "emailMessageId");

-- CreateIndex
CREATE INDEX "JobIntelligenceEventSource_workspaceId_eventId_idx" ON "JobIntelligenceEventSource"("workspaceId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "JobIntelligenceEventSource_workspaceId_eventId_emailMessageId_excerptHash_key" ON "JobIntelligenceEventSource"("workspaceId", "eventId", "emailMessageId", "excerptHash");

-- CreateIndex
CREATE INDEX "JobIntelligenceFact_workspaceId_jobId_factKey_idx" ON "JobIntelligenceFact"("workspaceId", "jobId", "factKey");

-- CreateIndex
CREATE INDEX "JobIntelligenceFact_workspaceId_jobId_verificationStatus_idx" ON "JobIntelligenceFact"("workspaceId", "jobId", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "JobIntelligenceFact_workspaceId_jobId_contentFingerprint_key" ON "JobIntelligenceFact"("workspaceId", "jobId", "contentFingerprint");

-- CreateIndex
CREATE INDEX "JobIntelligenceSummary_workspaceId_jobId_status_idx" ON "JobIntelligenceSummary"("workspaceId", "jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobIntelligenceSummary_workspaceId_jobId_version_key" ON "JobIntelligenceSummary"("workspaceId", "jobId", "version");

-- CreateIndex
CREATE INDEX "JobIntelligenceEmailState_workspaceId_jobId_status_idx" ON "JobIntelligenceEmailState"("workspaceId", "jobId", "status");

-- CreateIndex
CREATE INDEX "JobIntelligenceEmailState_workspaceId_emailMessageId_idx" ON "JobIntelligenceEmailState"("workspaceId", "emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "JobIntelligenceEmailState_workspaceId_jobId_emailMessageId_key" ON "JobIntelligenceEmailState"("workspaceId", "jobId", "emailMessageId");

-- AddForeignKey
ALTER TABLE "JobIntelligenceAnalysisRun" ADD CONSTRAINT "JobIntelligenceAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceAnalysisRun" ADD CONSTRAINT "JobIntelligenceAnalysisRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEvent" ADD CONSTRAINT "JobIntelligenceEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEvent" ADD CONSTRAINT "JobIntelligenceEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEvent" ADD CONSTRAINT "JobIntelligenceEvent_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "JobIntelligenceAnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEvent" ADD CONSTRAINT "JobIntelligenceEvent_supersededByEventId_fkey" FOREIGN KEY ("supersededByEventId") REFERENCES "JobIntelligenceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEventSource" ADD CONSTRAINT "JobIntelligenceEventSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEventSource" ADD CONSTRAINT "JobIntelligenceEventSource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "JobIntelligenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEventSource" ADD CONSTRAINT "JobIntelligenceEventSource_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEventSource" ADD CONSTRAINT "JobIntelligenceEventSource_emailAttachmentId_fkey" FOREIGN KEY ("emailAttachmentId") REFERENCES "EmailAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceFact" ADD CONSTRAINT "JobIntelligenceFact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceFact" ADD CONSTRAINT "JobIntelligenceFact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceFact" ADD CONSTRAINT "JobIntelligenceFact_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "JobIntelligenceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceFact" ADD CONSTRAINT "JobIntelligenceFact_supersededByFactId_fkey" FOREIGN KEY ("supersededByFactId") REFERENCES "JobIntelligenceFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceSummary" ADD CONSTRAINT "JobIntelligenceSummary_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceSummary" ADD CONSTRAINT "JobIntelligenceSummary_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceSummary" ADD CONSTRAINT "JobIntelligenceSummary_basedOnRunId_fkey" FOREIGN KEY ("basedOnRunId") REFERENCES "JobIntelligenceAnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEmailState" ADD CONSTRAINT "JobIntelligenceEmailState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEmailState" ADD CONSTRAINT "JobIntelligenceEmailState_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEmailState" ADD CONSTRAINT "JobIntelligenceEmailState_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobIntelligenceEmailState" ADD CONSTRAINT "JobIntelligenceEmailState_lastRunId_fkey" FOREIGN KEY ("lastRunId") REFERENCES "JobIntelligenceAnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
