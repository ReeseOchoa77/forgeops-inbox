-- CreateEnum
CREATE TYPE "ApprovedAccessStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "ApprovedAccess" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "status" "ApprovedAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovedAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovedAccess_email_idx" ON "ApprovedAccess"("email");
CREATE INDEX "ApprovedAccess_workspaceId_status_idx" ON "ApprovedAccess"("workspaceId", "status");
CREATE UNIQUE INDEX "ApprovedAccess_workspaceId_email_key" ON "ApprovedAccess"("workspaceId", "email");

-- AddForeignKey
ALTER TABLE "ApprovedAccess" ADD CONSTRAINT "ApprovedAccess_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovedAccess" ADD CONSTRAINT "ApprovedAccess_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
