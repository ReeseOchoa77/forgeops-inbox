-- Phase C: Job Milestones (operational schedule checkpoints)

CREATE TYPE "JobMilestoneType" AS ENUM (
  'GENERAL',
  'SHOP_DRAWINGS',
  'SUBMITTAL',
  'APPROVAL',
  'FIELD_MEASURE',
  'MATERIAL_REQUIRED',
  'MATERIAL_ORDERED',
  'MATERIAL_EXPECTED',
  'FABRICATION_START',
  'FABRICATION_COMPLETE',
  'READY_TO_SHIP',
  'DELIVERY',
  'INSTALLATION_START',
  'INSTALLATION_COMPLETE',
  'PROJECT_COMPLETE'
);

CREATE TYPE "JobMilestoneStatus" AS ENUM (
  'OPEN',
  'COMPLETE',
  'CANCELLED'
);

ALTER TYPE "JobActivityAction" ADD VALUE 'MILESTONE_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'MILESTONE_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'MILESTONE_COMPLETED';
ALTER TYPE "JobActivityAction" ADD VALUE 'MILESTONE_REOPENED';
ALTER TYPE "JobActivityAction" ADD VALUE 'MILESTONE_CANCELLED';
ALTER TYPE "JobActivityAction" ADD VALUE 'MILESTONE_DELETED';

CREATE TABLE "JobMilestone" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "workPackageId" TEXT,
  "type" "JobMilestoneType" NOT NULL DEFAULT 'GENERAL',
  "name" TEXT NOT NULL,
  "plannedDate" TIMESTAMP(3),
  "actualDate" TIMESTAMP(3),
  "status" "JobMilestoneStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobMilestone_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobMilestone_workspaceId_jobId_plannedDate_idx"
  ON "JobMilestone"("workspaceId", "jobId", "plannedDate");

CREATE INDEX "JobMilestone_workspaceId_jobId_status_idx"
  ON "JobMilestone"("workspaceId", "jobId", "status");

CREATE INDEX "JobMilestone_jobId_workPackageId_idx"
  ON "JobMilestone"("jobId", "workPackageId");

ALTER TABLE "JobMilestone"
  ADD CONSTRAINT "JobMilestone_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobMilestone"
  ADD CONSTRAINT "JobMilestone_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobMilestone"
  ADD CONSTRAINT "JobMilestone_workPackageId_fkey"
  FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
