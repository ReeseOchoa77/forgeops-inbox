-- AlterTable
ALTER TABLE "BidCandidate" ADD COLUMN     "proposedScopeDetail" JSONB;

-- AlterTable
ALTER TABLE "BidQuoteStaging" ADD COLUMN     "extractedScopeDetail" JSONB;
