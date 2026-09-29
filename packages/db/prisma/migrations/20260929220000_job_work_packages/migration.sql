-- Phase B: Job Work Packages + optional fabrication assignment

CREATE TYPE "JobWorkPackageStatus" AS ENUM (
  'NOT_STARTED',
  'DETAILING',
  'AWAITING_APPROVAL',
  'FIELD_MEASURE',
  'READY_FOR_FABRICATION',
  'FABRICATING',
  'READY_TO_SHIP',
  'DELIVERED',
  'INSTALLING',
  'COMPLETE',
  'ON_HOLD'
);

ALTER TYPE "JobActivityAction" ADD VALUE 'WORK_PACKAGE_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'WORK_PACKAGE_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'WORK_PACKAGE_DELETED';
ALTER TYPE "JobActivityAction" ADD VALUE 'FABRICATION_ITEM_MOVED';

CREATE TABLE "JobWorkPackage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "JobWorkPackageStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobWorkPackage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobWorkPackage_workspaceId_jobId_sortOrder_idx"
  ON "JobWorkPackage"("workspaceId", "jobId", "sortOrder");

CREATE INDEX "JobWorkPackage_jobId_parentId_idx"
  ON "JobWorkPackage"("jobId", "parentId");

CREATE INDEX "JobWorkPackage_workspaceId_status_idx"
  ON "JobWorkPackage"("workspaceId", "status");

ALTER TABLE "JobWorkPackage"
  ADD CONSTRAINT "JobWorkPackage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobWorkPackage"
  ADD CONSTRAINT "JobWorkPackage_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobWorkPackage"
  ADD CONSTRAINT "JobWorkPackage_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "JobWorkPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JobFabricationItem"
  ADD COLUMN "workPackageId" TEXT;

CREATE INDEX "JobFabricationItem_jobId_workPackageId_idx"
  ON "JobFabricationItem"("jobId", "workPackageId");

ALTER TABLE "JobFabricationItem"
  ADD CONSTRAINT "JobFabricationItem_workPackageId_fkey"
  FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
