-- Phase G: Outbound deliveries + installation events (not procurement receiving)

CREATE TYPE "JobShipmentStatus" AS ENUM ('PLANNED', 'READY', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
CREATE TYPE "JobInstallationEventType" AS ENUM ('STARTED', 'PROGRESS', 'COMPLETED');

ALTER TYPE "JobActivityAction" ADD VALUE 'DELIVERY_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DELIVERY_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DELIVERY_SHIPPED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DELIVERY_DELIVERED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DELIVERY_CANCELLED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DELIVERY_LINE_ADDED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DELIVERY_LINE_REMOVED';
ALTER TYPE "JobActivityAction" ADD VALUE 'INSTALLATION_RECORDED';
ALTER TYPE "JobActivityAction" ADD VALUE 'INSTALLATION_UPDATED';

ALTER TABLE "Job" ADD COLUMN "siteName" TEXT;
ALTER TABLE "Job" ADD COLUMN "siteAddress1" TEXT;
ALTER TABLE "Job" ADD COLUMN "siteAddress2" TEXT;
ALTER TABLE "Job" ADD COLUMN "siteCity" TEXT;
ALTER TABLE "Job" ADD COLUMN "siteState" TEXT;
ALTER TABLE "Job" ADD COLUMN "sitePostalCode" TEXT;

CREATE TABLE "JobShipment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "deliveryNumber" TEXT NOT NULL,
  "status" "JobShipmentStatus" NOT NULL DEFAULT 'PLANNED',
  "plannedShipDate" TIMESTAMP(3),
  "actualShipDate" TIMESTAMP(3),
  "plannedDeliveryDate" TIMESTAMP(3),
  "actualDeliveryDate" TIMESTAMP(3),
  "destinationName" TEXT,
  "destinationAddress1" TEXT,
  "destinationAddress2" TEXT,
  "destinationCity" TEXT,
  "destinationState" TEXT,
  "destinationPostalCode" TEXT,
  "carrierName" TEXT,
  "driverName" TEXT,
  "truckNumber" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobShipment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobShipment_workspaceId_jobId_status_idx" ON "JobShipment"("workspaceId", "jobId", "status");
CREATE INDEX "JobShipment_jobId_deliveryNumber_idx" ON "JobShipment"("jobId", "deliveryNumber");
CREATE INDEX "JobShipment_jobId_plannedDeliveryDate_idx" ON "JobShipment"("jobId", "plannedDeliveryDate");
CREATE INDEX "JobShipment_jobId_plannedShipDate_idx" ON "JobShipment"("jobId", "plannedShipDate");
ALTER TABLE "JobShipment" ADD CONSTRAINT "JobShipment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobShipment" ADD CONSTRAINT "JobShipment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JobShipmentItem" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "workPackageId" TEXT,
  "fabricationItemId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,4),
  "unit" TEXT,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobShipmentItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobShipmentItem_shipmentId_sortOrder_idx" ON "JobShipmentItem"("shipmentId", "sortOrder");
CREATE INDEX "JobShipmentItem_jobId_workPackageId_idx" ON "JobShipmentItem"("jobId", "workPackageId");
CREATE INDEX "JobShipmentItem_fabricationItemId_idx" ON "JobShipmentItem"("fabricationItemId");
ALTER TABLE "JobShipmentItem" ADD CONSTRAINT "JobShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "JobShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobShipmentItem" ADD CONSTRAINT "JobShipmentItem_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobShipmentItem" ADD CONSTRAINT "JobShipmentItem_fabricationItemId_fkey" FOREIGN KEY ("fabricationItemId") REFERENCES "JobFabricationItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JobShipmentDocument" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "documentRecordId" TEXT NOT NULL,
  CONSTRAINT "JobShipmentDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobShipmentDocument_shipmentId_documentRecordId_key" ON "JobShipmentDocument"("shipmentId", "documentRecordId");
CREATE INDEX "JobShipmentDocument_documentRecordId_idx" ON "JobShipmentDocument"("documentRecordId");
ALTER TABLE "JobShipmentDocument" ADD CONSTRAINT "JobShipmentDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "JobShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobShipmentDocument" ADD CONSTRAINT "JobShipmentDocument_documentRecordId_fkey" FOREIGN KEY ("documentRecordId") REFERENCES "JobDocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JobInstallationRecord" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "workPackageId" TEXT,
  "shipmentId" TEXT,
  "eventType" "JobInstallationEventType" NOT NULL DEFAULT 'PROGRESS',
  "eventDate" TIMESTAMP(3) NOT NULL,
  "participantId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobInstallationRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobInstallationRecord_workspaceId_jobId_eventDate_idx" ON "JobInstallationRecord"("workspaceId", "jobId", "eventDate");
CREATE INDEX "JobInstallationRecord_jobId_workPackageId_idx" ON "JobInstallationRecord"("jobId", "workPackageId");
CREATE INDEX "JobInstallationRecord_shipmentId_idx" ON "JobInstallationRecord"("shipmentId");
ALTER TABLE "JobInstallationRecord" ADD CONSTRAINT "JobInstallationRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobInstallationRecord" ADD CONSTRAINT "JobInstallationRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobInstallationRecord" ADD CONSTRAINT "JobInstallationRecord_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "JobWorkPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobInstallationRecord" ADD CONSTRAINT "JobInstallationRecord_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "JobShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobInstallationRecord" ADD CONSTRAINT "JobInstallationRecord_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "JobParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
