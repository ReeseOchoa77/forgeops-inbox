-- Native project-folder discovery: connection binding + match metadata.
ALTER TABLE "DiscoveredFolder"
  ADD COLUMN IF NOT EXISTS "inboxConnectionId" TEXT,
  ADD COLUMN IF NOT EXISTS "matchConfidence" DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS "matchReason" TEXT,
  ADD COLUMN IF NOT EXISTS "missingFromProvider" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "DiscoveredFolder_workspaceId_inboxConnectionId_idx"
  ON "DiscoveredFolder"("workspaceId", "inboxConnectionId");
