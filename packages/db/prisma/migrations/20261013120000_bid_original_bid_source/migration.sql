-- Quote-first reconstruction: provenance of original Bid email match.

CREATE TYPE "BidOriginalBidSource" AS ENUM ('NONE', 'BID_INVITES_FOLDER', 'INBOX_FALLBACK');

ALTER TABLE "BidCandidate" ADD COLUMN "originalBidSource" "BidOriginalBidSource" NOT NULL DEFAULT 'NONE';
