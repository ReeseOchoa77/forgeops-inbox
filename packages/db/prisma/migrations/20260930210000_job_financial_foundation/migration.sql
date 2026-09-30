-- Phase H: Job financial foundation baselines (not invoicing / AP / AR)
-- Additive only. No backfill of originalContractValue / originalEstimatedCost from totalCost.

ALTER TYPE "JobActivityAction" ADD VALUE 'ORIGINAL_CONTRACT_VALUE_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'ORIGINAL_ESTIMATED_COST_UPDATED';

-- Canonical sell-side baseline. NULL = unknown / not entered. 0 = explicit zero.
-- Independent of legacy Job.totalCost (semantics remain ambiguous).
ALTER TABLE "Job" ADD COLUMN "originalContractValue" DECIMAL(14,2);

-- Canonical cost-side baseline estimate. NULL = unknown / not entered. 0 = explicit zero.
-- Not derived from procurement actuals, fabrication hours, or Job.totalCost.
ALTER TABLE "Job" ADD COLUMN "originalEstimatedCost" DECIMAL(14,2);
