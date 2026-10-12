-- AlterEnum
ALTER TYPE "BidQuoteMatchStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "BidQuoteStaging" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "userEditedFields" JSONB;
