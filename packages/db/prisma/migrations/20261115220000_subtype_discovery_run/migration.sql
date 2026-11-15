-- CreateEnum
CREATE TYPE "SubtypeDiscoveryRunStatus" AS ENUM ('PENDING', 'RUNNING', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "SubtypeDiscoveryRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "SubtypeDiscoveryRunStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB NOT NULL,
    "sampledEmailIds" JSONB NOT NULL DEFAULT '[]',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB,
    "recommendations" JSONB,
    "algorithmVersions" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "initiatedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubtypeDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubtypeDiscoveryRun_workspaceId_createdAt_idx" ON "SubtypeDiscoveryRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SubtypeDiscoveryRun_workspaceId_status_idx" ON "SubtypeDiscoveryRun"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "SubtypeDiscoveryRun" ADD CONSTRAINT "SubtypeDiscoveryRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
