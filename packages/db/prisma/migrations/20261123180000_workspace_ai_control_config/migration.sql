CREATE TABLE "WorkspaceAiControlConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "subsystems" JSONB NOT NULL DEFAULT '{}',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceAiControlConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceAiControlConfig_workspaceId_key" ON "WorkspaceAiControlConfig"("workspaceId");
CREATE INDEX "WorkspaceAiControlConfig_workspaceId_idx" ON "WorkspaceAiControlConfig"("workspaceId");

ALTER TABLE "WorkspaceAiControlConfig" ADD CONSTRAINT "WorkspaceAiControlConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
