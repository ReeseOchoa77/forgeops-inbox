-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateTable: Customer
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "primaryEmail" TEXT,
    "domain" TEXT,
    "phone" TEXT,
    "externalRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Vendor
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "primaryEmail" TEXT,
    "domain" TEXT,
    "phone" TEXT,
    "externalRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Job
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobNumber" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',
    "externalRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- AddColumns: Classification linkage
ALTER TABLE "Classification" ADD COLUMN "customerId" TEXT;
ALTER TABLE "Classification" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "Classification" ADD COLUMN "jobId" TEXT;

-- AddColumns: Task linkage
ALTER TABLE "Task" ADD COLUMN "customerId" TEXT;
ALTER TABLE "Task" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "Task" ADD COLUMN "jobId" TEXT;

-- Customer indexes
CREATE UNIQUE INDEX "Customer_workspaceId_id_key" ON "Customer"("workspaceId", "id");
CREATE UNIQUE INDEX "Customer_workspaceId_normalizedName_key" ON "Customer"("workspaceId", "normalizedName");
CREATE INDEX "Customer_workspaceId_domain_idx" ON "Customer"("workspaceId", "domain");
CREATE INDEX "Customer_workspaceId_primaryEmail_idx" ON "Customer"("workspaceId", "primaryEmail");
CREATE INDEX "Customer_workspaceId_externalRef_idx" ON "Customer"("workspaceId", "externalRef");

-- Vendor indexes
CREATE UNIQUE INDEX "Vendor_workspaceId_id_key" ON "Vendor"("workspaceId", "id");
CREATE UNIQUE INDEX "Vendor_workspaceId_normalizedName_key" ON "Vendor"("workspaceId", "normalizedName");
CREATE INDEX "Vendor_workspaceId_domain_idx" ON "Vendor"("workspaceId", "domain");
CREATE INDEX "Vendor_workspaceId_primaryEmail_idx" ON "Vendor"("workspaceId", "primaryEmail");
CREATE INDEX "Vendor_workspaceId_externalRef_idx" ON "Vendor"("workspaceId", "externalRef");

-- Job indexes
CREATE UNIQUE INDEX "Job_workspaceId_id_key" ON "Job"("workspaceId", "id");
CREATE UNIQUE INDEX "Job_workspaceId_normalizedName_key" ON "Job"("workspaceId", "normalizedName");
CREATE INDEX "Job_workspaceId_jobNumber_idx" ON "Job"("workspaceId", "jobNumber");
CREATE INDEX "Job_workspaceId_customerId_idx" ON "Job"("workspaceId", "customerId");
CREATE INDEX "Job_workspaceId_status_idx" ON "Job"("workspaceId", "status");
CREATE INDEX "Job_workspaceId_externalRef_idx" ON "Job"("workspaceId", "externalRef");

-- Classification linkage indexes
CREATE INDEX "Classification_customerId_idx" ON "Classification"("customerId");
CREATE INDEX "Classification_vendorId_idx" ON "Classification"("vendorId");
CREATE INDEX "Classification_jobId_idx" ON "Classification"("jobId");

-- Task linkage indexes
CREATE INDEX "Task_customerId_idx" ON "Task"("customerId");
CREATE INDEX "Task_vendorId_idx" ON "Task"("vendorId");
CREATE INDEX "Task_jobId_idx" ON "Task"("jobId");

-- Foreign keys: Customer
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys: Vendor
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys: Job
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_customerId_fkey" FOREIGN KEY ("workspaceId", "customerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys: Classification linkage
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_workspaceId_customerId_fkey" FOREIGN KEY ("workspaceId", "customerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_workspaceId_vendorId_fkey" FOREIGN KEY ("workspaceId", "vendorId") REFERENCES "Vendor"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_workspaceId_jobId_fkey" FOREIGN KEY ("workspaceId", "jobId") REFERENCES "Job"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys: Task linkage
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_customerId_fkey" FOREIGN KEY ("workspaceId", "customerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_vendorId_fkey" FOREIGN KEY ("workspaceId", "vendorId") REFERENCES "Vendor"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_jobId_fkey" FOREIGN KEY ("workspaceId", "jobId") REFERENCES "Job"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
