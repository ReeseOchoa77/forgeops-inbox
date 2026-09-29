-- Phase D: Job document control metadata (sidecar over JobFile / EmailAttachment)

CREATE TYPE "JobDocumentRecordType" AS ENUM (
  'OTHER',
  'ARCHITECTURAL_DRAWING',
  'STRUCTURAL_DRAWING',
  'CIVIL_DRAWING',
  'SPECIFICATION',
  'SHOP_DRAWING',
  'SUBMITTAL',
  'RFI_DOCUMENT',
  'ASI',
  'BULLETIN',
  'ADDENDUM',
  'PROPOSAL_QUOTE',
  'PURCHASE_ORDER',
  'CONTRACT',
  'CHANGE_ORDER',
  'INVOICE',
  'DELIVERY_DOCUMENT'
);

CREATE TYPE "JobDocumentSubmittalStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'APPROVED_AS_NOTED',
  'REVISE_AND_RESUBMIT',
  'REJECTED'
);

ALTER TYPE "JobActivityAction" ADD VALUE 'DOCUMENT_CLASSIFIED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DOCUMENT_METADATA_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DOCUMENT_SUPERSEDED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DOCUMENT_CONTROL_CLEARED';

CREATE TABLE "JobDocumentRecord" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "jobFileId" TEXT,
  "emailAttachmentId" TEXT,
  "documentType" "JobDocumentRecordType" NOT NULL DEFAULT 'OTHER',
  "documentNumber" TEXT,
  "title" TEXT,
  "revision" TEXT,
  "documentDate" TIMESTAMP(3),
  "workPackageId" TEXT,
  "submittalStatus" "JobDocumentSubmittalStatus",
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "supersedesId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobDocumentRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobDocumentRecord_jobFileId_key" ON "JobDocumentRecord"("jobFileId");
CREATE UNIQUE INDEX "JobDocumentRecord_emailAttachmentId_key" ON "JobDocumentRecord"("emailAttachmentId");

CREATE INDEX "JobDocumentRecord_workspaceId_jobId_documentType_idx"
  ON "JobDocumentRecord"("workspaceId", "jobId", "documentType");

CREATE INDEX "JobDocumentRecord_workspaceId_jobId_isCurrent_idx"
  ON "JobDocumentRecord"("workspaceId", "jobId", "isCurrent");

CREATE INDEX "JobDocumentRecord_jobId_workPackageId_idx"
  ON "JobDocumentRecord"("jobId", "workPackageId");

CREATE INDEX "JobDocumentRecord_jobId_documentNumber_idx"
  ON "JobDocumentRecord"("jobId", "documentNumber");

ALTER TABLE "JobDocumentRecord"
  ADD CONSTRAINT "JobDocumentRecord_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobDocumentRecord"
  ADD CONSTRAINT "JobDocumentRecord_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobDocumentRecord"
  ADD CONSTRAINT "JobDocumentRecord_jobFileId_fkey"
  FOREIGN KEY ("jobFileId") REFERENCES "JobFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobDocumentRecord"
  ADD CONSTRAINT "JobDocumentRecord_emailAttachmentId_fkey"
  FOREIGN KEY ("emailAttachmentId") REFERENCES "EmailAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobDocumentRecord"
  ADD CONSTRAINT "JobDocumentRecord_workPackageId_fkey"
  FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JobDocumentRecord"
  ADD CONSTRAINT "JobDocumentRecord_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "JobDocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
