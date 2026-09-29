-- Phase E: Project communications + change management

CREATE TYPE "JobRfiStatus" AS ENUM ('DRAFT', 'OPEN', 'ANSWERED', 'CLOSED', 'CANCELLED');
CREATE TYPE "JobDirectiveType" AS ENUM ('ASI', 'BULLETIN', 'ADDENDUM', 'OTHER');
CREATE TYPE "JobDirectiveStatus" AS ENUM ('ACTIVE', 'VOID');
CREATE TYPE "JobChangeType" AS ENUM ('EXTRA', 'CREDIT', 'SCOPE_CHANGE', 'REWORK', 'BACKCHARGE', 'OTHER');
CREATE TYPE "JobChangeStatus" AS ENUM ('IDENTIFIED', 'PRICING', 'PROPOSED', 'APPROVED', 'REJECTED', 'VOID');
CREATE TYPE "JobChangeOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'VOID');

ALTER TYPE "JobActivityAction" ADD VALUE 'RFI_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'RFI_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'RFI_ANSWERED';
ALTER TYPE "JobActivityAction" ADD VALUE 'RFI_CLOSED';
ALTER TYPE "JobActivityAction" ADD VALUE 'RFI_CANCELLED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DIRECTIVE_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DIRECTIVE_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DIRECTIVE_VOIDED';
ALTER TYPE "JobActivityAction" ADD VALUE 'CHANGE_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'CHANGE_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'CHANGE_STATUS_CHANGED';
ALTER TYPE "JobActivityAction" ADD VALUE 'CHANGE_ORDER_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'CHANGE_ORDER_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'CHANGE_ORDER_STATUS_CHANGED';

CREATE TABLE "JobRfi" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "question" TEXT,
  "status" "JobRfiStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedDate" TIMESTAMP(3),
  "responseDueDate" TIMESTAMP(3),
  "answeredDate" TIMESTAMP(3),
  "response" TEXT,
  "requestedByParticipantId" TEXT,
  "assignedToParticipantId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobRfi_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobRfi_workspaceId_jobId_status_idx" ON "JobRfi"("workspaceId", "jobId", "status");
CREATE INDEX "JobRfi_jobId_number_idx" ON "JobRfi"("jobId", "number");
CREATE INDEX "JobRfi_jobId_responseDueDate_idx" ON "JobRfi"("jobId", "responseDueDate");
ALTER TABLE "JobRfi" ADD CONSTRAINT "JobRfi_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRfi" ADD CONSTRAINT "JobRfi_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRfi" ADD CONSTRAINT "JobRfi_requestedByParticipantId_fkey" FOREIGN KEY ("requestedByParticipantId") REFERENCES "JobParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobRfi" ADD CONSTRAINT "JobRfi_assignedToParticipantId_fkey" FOREIGN KEY ("assignedToParticipantId") REFERENCES "JobParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JobRfiWorkPackage" (
  "id" TEXT NOT NULL,
  "rfiId" TEXT NOT NULL,
  "workPackageId" TEXT NOT NULL,
  CONSTRAINT "JobRfiWorkPackage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobRfiWorkPackage_rfiId_workPackageId_key" ON "JobRfiWorkPackage"("rfiId", "workPackageId");
CREATE INDEX "JobRfiWorkPackage_workPackageId_idx" ON "JobRfiWorkPackage"("workPackageId");
ALTER TABLE "JobRfiWorkPackage" ADD CONSTRAINT "JobRfiWorkPackage_rfiId_fkey" FOREIGN KEY ("rfiId") REFERENCES "JobRfi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRfiWorkPackage" ADD CONSTRAINT "JobRfiWorkPackage_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JobRfiDocument" (
  "id" TEXT NOT NULL,
  "rfiId" TEXT NOT NULL,
  "documentRecordId" TEXT NOT NULL,
  CONSTRAINT "JobRfiDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobRfiDocument_rfiId_documentRecordId_key" ON "JobRfiDocument"("rfiId", "documentRecordId");
CREATE INDEX "JobRfiDocument_documentRecordId_idx" ON "JobRfiDocument"("documentRecordId");
ALTER TABLE "JobRfiDocument" ADD CONSTRAINT "JobRfiDocument_rfiId_fkey" FOREIGN KEY ("rfiId") REFERENCES "JobRfi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRfiDocument" ADD CONSTRAINT "JobRfiDocument_documentRecordId_fkey" FOREIGN KEY ("documentRecordId") REFERENCES "JobDocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JobDirective" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "type" "JobDirectiveType" NOT NULL,
  "status" "JobDirectiveStatus" NOT NULL DEFAULT 'ACTIVE',
  "number" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "issuedDate" TIMESTAMP(3),
  "summary" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobDirective_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobDirective_workspaceId_jobId_type_idx" ON "JobDirective"("workspaceId", "jobId", "type");
CREATE INDEX "JobDirective_jobId_number_idx" ON "JobDirective"("jobId", "number");
ALTER TABLE "JobDirective" ADD CONSTRAINT "JobDirective_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobDirective" ADD CONSTRAINT "JobDirective_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JobDirectiveWorkPackage" (
  "id" TEXT NOT NULL,
  "directiveId" TEXT NOT NULL,
  "workPackageId" TEXT NOT NULL,
  CONSTRAINT "JobDirectiveWorkPackage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobDirectiveWorkPackage_directiveId_workPackageId_key" ON "JobDirectiveWorkPackage"("directiveId", "workPackageId");
CREATE INDEX "JobDirectiveWorkPackage_workPackageId_idx" ON "JobDirectiveWorkPackage"("workPackageId");
ALTER TABLE "JobDirectiveWorkPackage" ADD CONSTRAINT "JobDirectiveWorkPackage_directiveId_fkey" FOREIGN KEY ("directiveId") REFERENCES "JobDirective"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobDirectiveWorkPackage" ADD CONSTRAINT "JobDirectiveWorkPackage_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JobDirectiveDocument" (
  "id" TEXT NOT NULL,
  "directiveId" TEXT NOT NULL,
  "documentRecordId" TEXT NOT NULL,
  CONSTRAINT "JobDirectiveDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobDirectiveDocument_directiveId_documentRecordId_key" ON "JobDirectiveDocument"("directiveId", "documentRecordId");
CREATE INDEX "JobDirectiveDocument_documentRecordId_idx" ON "JobDirectiveDocument"("documentRecordId");
ALTER TABLE "JobDirectiveDocument" ADD CONSTRAINT "JobDirectiveDocument_directiveId_fkey" FOREIGN KEY ("directiveId") REFERENCES "JobDirective"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobDirectiveDocument" ADD CONSTRAINT "JobDirectiveDocument_documentRecordId_fkey" FOREIGN KEY ("documentRecordId") REFERENCES "JobDocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JobChangeOrder" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "title" TEXT,
  "status" "JobChangeOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedDate" TIMESTAMP(3),
  "approvedDate" TIMESTAMP(3),
  "sellAmount" DECIMAL(14,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobChangeOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobChangeOrder_workspaceId_jobId_status_idx" ON "JobChangeOrder"("workspaceId", "jobId", "status");
CREATE INDEX "JobChangeOrder_jobId_number_idx" ON "JobChangeOrder"("jobId", "number");
ALTER TABLE "JobChangeOrder" ADD CONSTRAINT "JobChangeOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobChangeOrder" ADD CONSTRAINT "JobChangeOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JobChange" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "JobChangeType" NOT NULL DEFAULT 'SCOPE_CHANGE',
  "status" "JobChangeStatus" NOT NULL DEFAULT 'IDENTIFIED',
  "sourceRfiId" TEXT,
  "sourceDirectiveId" TEXT,
  "changeOrderId" TEXT,
  "costImpact" DECIMAL(14,2),
  "sellImpact" DECIMAL(14,2),
  "scheduleImpactDays" INTEGER,
  "scheduleImpactNote" TEXT,
  "identifiedDate" TIMESTAMP(3),
  "proposedDate" TIMESTAMP(3),
  "approvedDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobChange_workspaceId_jobId_status_idx" ON "JobChange"("workspaceId", "jobId", "status");
CREATE INDEX "JobChange_jobId_number_idx" ON "JobChange"("jobId", "number");
CREATE INDEX "JobChange_changeOrderId_idx" ON "JobChange"("changeOrderId");
CREATE INDEX "JobChange_sourceRfiId_idx" ON "JobChange"("sourceRfiId");
CREATE INDEX "JobChange_sourceDirectiveId_idx" ON "JobChange"("sourceDirectiveId");
ALTER TABLE "JobChange" ADD CONSTRAINT "JobChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobChange" ADD CONSTRAINT "JobChange_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobChange" ADD CONSTRAINT "JobChange_sourceRfiId_fkey" FOREIGN KEY ("sourceRfiId") REFERENCES "JobRfi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobChange" ADD CONSTRAINT "JobChange_sourceDirectiveId_fkey" FOREIGN KEY ("sourceDirectiveId") REFERENCES "JobDirective"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobChange" ADD CONSTRAINT "JobChange_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "JobChangeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "JobChangeWorkPackage" (
  "id" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "workPackageId" TEXT NOT NULL,
  CONSTRAINT "JobChangeWorkPackage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobChangeWorkPackage_changeId_workPackageId_key" ON "JobChangeWorkPackage"("changeId", "workPackageId");
CREATE INDEX "JobChangeWorkPackage_workPackageId_idx" ON "JobChangeWorkPackage"("workPackageId");
ALTER TABLE "JobChangeWorkPackage" ADD CONSTRAINT "JobChangeWorkPackage_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "JobChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobChangeWorkPackage" ADD CONSTRAINT "JobChangeWorkPackage_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
