-- Phase I: Project billing / invoice tracking (not AR, payments, retainage, or AIA SOV)

CREATE TYPE "JobInvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'VOID');

ALTER TYPE "JobActivityAction" ADD VALUE 'INVOICE_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'INVOICE_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'INVOICE_SUBMITTED';
ALTER TYPE "JobActivityAction" ADD VALUE 'INVOICE_APPROVED';
ALTER TYPE "JobActivityAction" ADD VALUE 'INVOICE_REJECTED';
ALTER TYPE "JobActivityAction" ADD VALUE 'INVOICE_VOIDED';
ALTER TYPE "JobActivityAction" ADD VALUE 'INVOICE_DELETED';

CREATE TABLE "JobInvoice" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "billingPeriodStart" TIMESTAMP(3),
  "billingPeriodEnd" TIMESTAMP(3),
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "status" "JobInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "amount" DECIMAL(14,2),
  "billToCustomerId" TEXT,
  "documentRecordId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobInvoice_documentRecordId_key" ON "JobInvoice"("documentRecordId");
CREATE INDEX "JobInvoice_workspaceId_jobId_status_idx" ON "JobInvoice"("workspaceId", "jobId", "status");
CREATE INDEX "JobInvoice_jobId_invoiceNumber_idx" ON "JobInvoice"("jobId", "invoiceNumber");
CREATE INDEX "JobInvoice_jobId_invoiceDate_idx" ON "JobInvoice"("jobId", "invoiceDate");
CREATE INDEX "JobInvoice_billToCustomerId_idx" ON "JobInvoice"("billToCustomerId");

ALTER TABLE "JobInvoice" ADD CONSTRAINT "JobInvoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobInvoice" ADD CONSTRAINT "JobInvoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobInvoice" ADD CONSTRAINT "JobInvoice_workspaceId_billToCustomerId_fkey" FOREIGN KEY ("workspaceId", "billToCustomerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobInvoice" ADD CONSTRAINT "JobInvoice_documentRecordId_fkey" FOREIGN KEY ("documentRecordId") REFERENCES "JobDocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JobInvoiceChangeOrderAllocation" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "changeOrderId" TEXT NOT NULL,
  "amount" DECIMAL(14,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobInvoiceChangeOrderAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobInvoiceChangeOrderAllocation_invoiceId_changeOrderId_key" ON "JobInvoiceChangeOrderAllocation"("invoiceId", "changeOrderId");
CREATE INDEX "JobInvoiceChangeOrderAllocation_changeOrderId_idx" ON "JobInvoiceChangeOrderAllocation"("changeOrderId");

ALTER TABLE "JobInvoiceChangeOrderAllocation" ADD CONSTRAINT "JobInvoiceChangeOrderAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "JobInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobInvoiceChangeOrderAllocation" ADD CONSTRAINT "JobInvoiceChangeOrderAllocation_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "JobChangeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
