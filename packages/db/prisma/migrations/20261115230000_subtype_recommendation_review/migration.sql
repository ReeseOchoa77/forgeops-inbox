-- CreateEnum
CREATE TYPE "SubtypeRecommendationDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "TaxonomyRevisionChangeType" AS ENUM ('ADD_SUBTYPE', 'EDIT_SUBTYPE', 'MERGE_SUBTYPE', 'DEACTIVATE_SUBTYPE', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "TaxonomyRevisionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "TaxonomyRevision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TaxonomyRevisionStatus" NOT NULL DEFAULT 'ACTIVE',
    "changeType" "TaxonomyRevisionChangeType" NOT NULL,
    "payload" JSONB NOT NULL,
    "businessTypeId" TEXT,
    "systemKey" TEXT,
    "discoveryRunId" TEXT,
    "recommendationId" TEXT,
    "previousRevisionId" TEXT,
    "approvedByUserId" TEXT NOT NULL,
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackByUserId" TEXT,
    "rollbackOfRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxonomyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtypeRecommendationDecision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "discoveryRunId" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "status" "SubtypeRecommendationDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "editedPayload" JSONB,
    "mergeTargetKey" TEXT,
    "notes" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "taxonomyRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubtypeRecommendationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtypeTaxonomyEvalRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "discoveryRunId" TEXT,
    "label" TEXT NOT NULL DEFAULT 'experimental',
    "datasetEmailIds" JSONB NOT NULL DEFAULT '[]',
    "taxonomySnapshot" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "emailChanges" JSONB,
    "groundTruthQuality" TEXT NOT NULL DEFAULT 'WEAK',
    "methodologyNotes" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtypeTaxonomyEvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyRevision_workspaceId_version_key" ON "TaxonomyRevision"("workspaceId", "version");
CREATE INDEX "TaxonomyRevision_workspaceId_createdAt_idx" ON "TaxonomyRevision"("workspaceId", "createdAt");
CREATE INDEX "TaxonomyRevision_workspaceId_status_idx" ON "TaxonomyRevision"("workspaceId", "status");
CREATE INDEX "TaxonomyRevision_businessTypeId_idx" ON "TaxonomyRevision"("businessTypeId");

CREATE UNIQUE INDEX "SubtypeRecommendationDecision_discoveryRunId_recommendationId_key" ON "SubtypeRecommendationDecision"("discoveryRunId", "recommendationId");
CREATE INDEX "SubtypeRecommendationDecision_workspaceId_status_idx" ON "SubtypeRecommendationDecision"("workspaceId", "status");
CREATE INDEX "SubtypeRecommendationDecision_workspaceId_discoveryRunId_idx" ON "SubtypeRecommendationDecision"("workspaceId", "discoveryRunId");

CREATE INDEX "SubtypeTaxonomyEvalRun_workspaceId_createdAt_idx" ON "SubtypeTaxonomyEvalRun"("workspaceId", "createdAt");
CREATE INDEX "SubtypeTaxonomyEvalRun_workspaceId_discoveryRunId_idx" ON "SubtypeTaxonomyEvalRun"("workspaceId", "discoveryRunId");

-- AddForeignKey
ALTER TABLE "TaxonomyRevision" ADD CONSTRAINT "TaxonomyRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxonomyRevision" ADD CONSTRAINT "TaxonomyRevision_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "SubtypeDiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubtypeRecommendationDecision" ADD CONSTRAINT "SubtypeRecommendationDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubtypeRecommendationDecision" ADD CONSTRAINT "SubtypeRecommendationDecision_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "SubtypeDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubtypeRecommendationDecision" ADD CONSTRAINT "SubtypeRecommendationDecision_taxonomyRevisionId_fkey" FOREIGN KEY ("taxonomyRevisionId") REFERENCES "TaxonomyRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubtypeTaxonomyEvalRun" ADD CONSTRAINT "SubtypeTaxonomyEvalRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubtypeTaxonomyEvalRun" ADD CONSTRAINT "SubtypeTaxonomyEvalRun_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "SubtypeDiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
