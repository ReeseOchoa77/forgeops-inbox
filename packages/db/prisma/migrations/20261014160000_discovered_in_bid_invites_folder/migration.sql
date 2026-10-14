-- Durable Projects/Bid Invites folder provenance on EmailMessage.
-- Inbox "Bid Candidate" filter uses this flag (not BID_OPPORTUNITY / BidCandidateEmail alone).
-- Survives Clear Analysis (which deletes BidFolderDiscoveryEmail).

ALTER TABLE "EmailMessage"
  ADD COLUMN IF NOT EXISTS "discoveredInBidInvitesFolder" BOOLEAN NOT NULL DEFAULT false;

-- Backfill from ephemeral discovery index (if still present) and Classification provenance.
UPDATE "EmailMessage" em
SET "discoveredInBidInvitesFolder" = true
WHERE em."discoveredInBidInvitesFolder" = false
  AND (
    EXISTS (
      SELECT 1
      FROM "BidFolderDiscoveryEmail" d
      WHERE d."emailMessageId" = em.id
        AND d."role" = 'BID_INVITE'
    )
    OR EXISTS (
      SELECT 1
      FROM "Classification" c
      WHERE c."messageId" = em.id
        AND c."routingHints"::text LIKE '%bid_invites_folder%'
    )
  );

CREATE INDEX IF NOT EXISTS "EmailMessage_workspaceId_discoveredInBidInvitesFolder_sentAt_idx"
  ON "EmailMessage"("workspaceId", "discoveredInBidInvitesFolder", "sentAt");

CREATE INDEX IF NOT EXISTS "EmailMessage_workspaceId_inboxConnectionId_discoveredInBidInvitesFolder_sentAt_idx"
  ON "EmailMessage"("workspaceId", "inboxConnectionId", "discoveredInBidInvitesFolder", "sentAt");
