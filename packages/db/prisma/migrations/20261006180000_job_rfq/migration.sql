-- Estimating RFQs (Request for Quote) — distinct from RFI / Procurement.
CREATE TYPE "JobRfqStatus" AS ENUM ('DRAFT', 'REQUESTED', 'RECEIVED', 'DECLINED', 'CANCELLED');

ALTER TYPE "JobActivityAction" ADD VALUE 'RFQ_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'RFQ_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'RFQ_STATUS_CHANGED';
ALTER TYPE "JobActivityAction" ADD VALUE 'RFQ_DELETED';

CREATE TABLE "JobRfq" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "vendorId" TEXT,
    "workPackageId" TEXT,
    "emailMessageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "JobRfqStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "receivedDate" TIMESTAMP(3),
    "quotedAmount" DECIMAL(14,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRfq_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobRfqDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "documentRecordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRfqDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobRfq_workspaceId_jobId_status_idx" ON "JobRfq"("workspaceId", "jobId", "status");
CREATE INDEX "JobRfq_jobId_vendorId_idx" ON "JobRfq"("jobId", "vendorId");
CREATE INDEX "JobRfq_jobId_workPackageId_idx" ON "JobRfq"("jobId", "workPackageId");
CREATE INDEX "JobRfq_emailMessageId_idx" ON "JobRfq"("emailMessageId");

CREATE UNIQUE INDEX "JobRfqDocument_rfqId_documentRecordId_key" ON "JobRfqDocument"("rfqId", "documentRecordId");
CREATE INDEX "JobRfqDocument_jobId_rfqId_idx" ON "JobRfqDocument"("jobId", "rfqId");
CREATE INDEX "JobRfqDocument_documentRecordId_idx" ON "JobRfqDocument"("documentRecordId");

ALTER TABLE "JobRfq" ADD CONSTRAINT "JobRfq_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRfq" ADD CONSTRAINT "JobRfq_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRfq" ADD CONSTRAINT "JobRfq_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobRfq" ADD CONSTRAINT "JobRfq_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobRfq" ADD CONSTRAINT "JobRfq_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JobRfqDocument" ADD CONSTRAINT "JobRfqDocument_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "JobRfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRfqDocument" ADD CONSTRAINT "JobRfqDocument_documentRecordId_fkey" FOREIGN KEY ("documentRecordId") REFERENCES "JobDocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
