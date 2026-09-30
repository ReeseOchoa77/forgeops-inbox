-- Phase F: Procurement + material / outsourced item tracking (not inventory)

CREATE TYPE "JobProcurementCategory" AS ENUM (
  'MATERIAL',
  'JOIST_DECK',
  'HARDWARE',
  'COATING',
  'OUTSOURCED_FABRICATION',
  'DETAILING',
  'ENGINEERING',
  'TESTING',
  'OTHER'
);

CREATE TYPE "JobProcurementItemStatus" AS ENUM (
  'NEEDED',
  'PRICING',
  'READY_TO_ORDER',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED'
);

CREATE TYPE "JobPurchaseOrderStatus" AS ENUM (
  'DRAFT',
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED'
);

ALTER TYPE "JobActivityAction" ADD VALUE 'PROCUREMENT_ITEM_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PROCUREMENT_ITEM_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PROCUREMENT_ITEM_CANCELLED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PROCUREMENT_RECEIPT_RECORDED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PROCUREMENT_ITEM_COMPLETED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PURCHASE_ORDER_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PURCHASE_ORDER_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PURCHASE_ORDER_ISSUED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PURCHASE_ORDER_CANCELLED';

CREATE TABLE "JobPurchaseOrder" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "poNumber" TEXT NOT NULL,
  "vendorId" TEXT,
  "status" "JobPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "orderedDate" TIMESTAMP(3),
  "expectedDate" TIMESTAMP(3),
  "amount" DECIMAL(14,2),
  "documentRecordId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobPurchaseOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobPurchaseOrder_workspaceId_jobId_status_idx" ON "JobPurchaseOrder"("workspaceId", "jobId", "status");
CREATE INDEX "JobPurchaseOrder_jobId_poNumber_idx" ON "JobPurchaseOrder"("jobId", "poNumber");
CREATE INDEX "JobPurchaseOrder_vendorId_idx" ON "JobPurchaseOrder"("vendorId");
CREATE INDEX "JobPurchaseOrder_documentRecordId_idx" ON "JobPurchaseOrder"("documentRecordId");
ALTER TABLE "JobPurchaseOrder" ADD CONSTRAINT "JobPurchaseOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobPurchaseOrder" ADD CONSTRAINT "JobPurchaseOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobPurchaseOrder" ADD CONSTRAINT "JobPurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobPurchaseOrder" ADD CONSTRAINT "JobPurchaseOrder_documentRecordId_fkey" FOREIGN KEY ("documentRecordId") REFERENCES "JobDocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JobProcurementItem" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "workPackageId" TEXT,
  "category" "JobProcurementCategory" NOT NULL DEFAULT 'MATERIAL',
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,4),
  "unit" TEXT,
  "status" "JobProcurementItemStatus" NOT NULL DEFAULT 'NEEDED',
  "vendorId" TEXT,
  "requiredDate" TIMESTAMP(3),
  "expectedDate" TIMESTAMP(3),
  "receivedDate" TIMESTAMP(3),
  "estimatedCost" DECIMAL(14,2),
  "actualCost" DECIMAL(14,2),
  "purchaseOrderId" TEXT,
  "sourceChangeId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobProcurementItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobProcurementItem_workspaceId_jobId_status_idx" ON "JobProcurementItem"("workspaceId", "jobId", "status");
CREATE INDEX "JobProcurementItem_jobId_workPackageId_idx" ON "JobProcurementItem"("jobId", "workPackageId");
CREATE INDEX "JobProcurementItem_jobId_vendorId_idx" ON "JobProcurementItem"("jobId", "vendorId");
CREATE INDEX "JobProcurementItem_purchaseOrderId_idx" ON "JobProcurementItem"("purchaseOrderId");
CREATE INDEX "JobProcurementItem_sourceChangeId_idx" ON "JobProcurementItem"("sourceChangeId");
CREATE INDEX "JobProcurementItem_jobId_requiredDate_idx" ON "JobProcurementItem"("jobId", "requiredDate");
CREATE INDEX "JobProcurementItem_jobId_expectedDate_idx" ON "JobProcurementItem"("jobId", "expectedDate");
ALTER TABLE "JobProcurementItem" ADD CONSTRAINT "JobProcurementItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobProcurementItem" ADD CONSTRAINT "JobProcurementItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobProcurementItem" ADD CONSTRAINT "JobProcurementItem_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobProcurementItem" ADD CONSTRAINT "JobProcurementItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobProcurementItem" ADD CONSTRAINT "JobProcurementItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "JobPurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobProcurementItem" ADD CONSTRAINT "JobProcurementItem_sourceChangeId_fkey" FOREIGN KEY ("sourceChangeId") REFERENCES "JobChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JobProcurementReceipt" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "procurementItemId" TEXT NOT NULL,
  "receivedDate" TIMESTAMP(3) NOT NULL,
  "quantityReceived" DECIMAL(14,4),
  "marksComplete" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobProcurementReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobProcurementReceipt_procurementItemId_receivedDate_idx" ON "JobProcurementReceipt"("procurementItemId", "receivedDate");
CREATE INDEX "JobProcurementReceipt_workspaceId_jobId_idx" ON "JobProcurementReceipt"("workspaceId", "jobId");
ALTER TABLE "JobProcurementReceipt" ADD CONSTRAINT "JobProcurementReceipt_procurementItemId_fkey" FOREIGN KEY ("procurementItemId") REFERENCES "JobProcurementItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
