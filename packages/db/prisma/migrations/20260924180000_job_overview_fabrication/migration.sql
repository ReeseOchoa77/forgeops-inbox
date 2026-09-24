-- Job overview: entered total cost, estimator, contractor, and client.
-- customerId stays as the existing single customer link used by the jobs list.
ALTER TABLE "Job" ADD COLUMN "totalCost" DECIMAL(14,2);
ALTER TABLE "Job" ADD COLUMN "estimatorUserId" TEXT;
ALTER TABLE "Job" ADD COLUMN "contractorCustomerId" TEXT;
ALTER TABLE "Job" ADD COLUMN "clientCustomerId" TEXT;

ALTER TABLE "Job" ADD CONSTRAINT "Job_estimatorUserId_fkey" FOREIGN KEY ("estimatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_contractorCustomerId_fkey" FOREIGN KEY ("workspaceId", "contractorCustomerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_clientCustomerId_fkey" FOREIGN KEY ("workspaceId", "clientCustomerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JobFabricationItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "estimatedHoursPerPiece" DECIMAL(10,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobFabricationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobFabricationItem_workspaceId_jobId_sortOrder_idx" ON "JobFabricationItem"("workspaceId", "jobId", "sortOrder");

ALTER TABLE "JobFabricationItem" ADD CONSTRAINT "JobFabricationItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
