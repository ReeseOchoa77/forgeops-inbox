-- Bid deadline for pre-award jobs. Does not replace start or target completion.
ALTER TABLE "Job" ADD COLUMN "bidDueAt" TIMESTAMP(3);

CREATE INDEX "Job_workspaceId_status_bidDueAt_idx" ON "Job"("workspaceId", "status", "bidDueAt");
