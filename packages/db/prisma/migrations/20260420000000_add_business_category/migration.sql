-- CreateEnum
CREATE TYPE "BusinessCategory" AS ENUM ('BUSINESS', 'NON_BUSINESS');

-- AddColumn
ALTER TABLE "Classification" ADD COLUMN "businessCategory" "BusinessCategory";

-- CreateIndex
CREATE INDEX "Classification_workspaceId_businessCategory_idx" ON "Classification"("workspaceId", "businessCategory");
