import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { totalEstimatedHours } from "./job-fabrication.js";

/**
 * Phase H — Job financial foundation.
 *
 * Sell side (revenue) is derived from originalContractValue + APPROVED JobChangeOrder.sellAmount.
 * Cost side (estimate) is derived from originalEstimatedCost + APPROVED JobChange.costImpact.
 * Procurement commitments use active PO.amount; known item actualCost is separate — never added.
 * Does not mutate Job.totalCost, Changes, COs, POs, shipments, milestones, or packages.
 * Does not create billing documents or recognize revenue from deliveries.
 */

export type MoneyInput = { toString(): string } | string | number | null | undefined;

export type JobFinancialSnapshot = {
  originalContractValue: string | null;
  approvedChangeOrderValue: string | null;
  approvedChangeOrderKnownCount: number;
  approvedChangeOrderUnknownCount: number;
  revisedContractValue: string | null;
  revisedContractValueComplete: boolean;
  pendingProposedSellValue: string | null;
  pendingProposedSellUnknownCount: number;
  pendingChangeOrderValue: string | null;
  pendingChangeOrderUnknownCount: number;
  originalEstimatedCost: string | null;
  approvedChangeEstimatedCost: string | null;
  approvedChangeCostKnownCount: number;
  approvedChangeCostUnknownCount: number;
  currentEstimatedCost: string | null;
  currentEstimatedCostComplete: boolean;
  purchaseOrderCommittedValue: string | null;
  purchaseOrderCommittedKnownCount: number;
  purchaseOrderUnknownCount: number;
  knownProcurementActualCost: string | null;
  knownProcurementActualCount: number;
  estimatedGrossProfit: string | null;
  estimatedGrossMarginPercent: string | null;
  estimatedFabricationHours: number;
  /** Legacy Job.totalCost — ambiguous semantics; not used in derived financials. */
  legacyEnteredTotal: string | null;
};

const COMMITTED_PO_STATUSES = new Set(["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"]);
const PENDING_CO_STATUSES = new Set(["DRAFT", "SUBMITTED"]);
const PENDING_CHANGE_STATUSES = new Set(["PROPOSED", "PRICING"]);

export function moneyToString(value: MoneyInput): string | null {
  if (value == null || value === "") return null;
  return new PrismaNS.Decimal(value.toString()).toFixed(2);
}

export function normalizeMoney(raw: unknown): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error("Invalid money amount");
  return new PrismaNS.Decimal(n.toFixed(2));
}

function toDecimal(value: MoneyInput): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  return new PrismaNS.Decimal(value.toString());
}

function sumKnown(values: Array<MoneyInput>): {
  sum: Prisma.Decimal | null;
  knownCount: number;
  unknownCount: number;
} {
  let sum: Prisma.Decimal | null = null;
  let knownCount = 0;
  let unknownCount = 0;
  for (const v of values) {
    const d = toDecimal(v);
    if (d == null) {
      unknownCount += 1;
      continue;
    }
    knownCount += 1;
    sum = sum == null ? d : sum.add(d);
  }
  return { sum, knownCount, unknownCount };
}

/** Zero-row category → explicit "0.00"; unknowns-only → null. */
function presentSum(
  sum: Prisma.Decimal | null,
  knownCount: number,
  totalRows: number
): string | null {
  if (totalRows === 0) return "0.00";
  if (knownCount === 0) return null;
  return moneyToString(sum);
}

export type FinancialSnapshotInputs = {
  originalContractValue: MoneyInput;
  originalEstimatedCost: MoneyInput;
  legacyEnteredTotal: MoneyInput;
  changeOrders: Array<{ status: string; sellAmount: MoneyInput }>;
  changes: Array<{ status: string; sellImpact: MoneyInput; costImpact: MoneyInput }>;
  purchaseOrders: Array<{ status: string; amount: MoneyInput }>;
  procurementItems: Array<{ status: string; actualCost: MoneyInput }>;
  fabricationItems: Array<{ quantity: number; estimatedHoursPerPiece: number }>;
};

/**
 * Pure canonical financial calculation. Prefer this over ad-hoc formulas in routes/UI.
 *
 * Revenue rule: APPROVED ChangeOrder.sellAmount only (not Change.sellImpact).
 * Cost rule: APPROVED JobChange.costImpact (operational approval; CO paperwork not required).
 * PO commitments: ISSUED | PARTIALLY_RECEIVED | RECEIVED with known amount.
 * Item actualCost is never added to PO commitments.
 */
export function computeJobFinancialSnapshot(input: FinancialSnapshotInputs): JobFinancialSnapshot {
  const originalContractValue = moneyToString(input.originalContractValue);
  const originalEstimatedCost = moneyToString(input.originalEstimatedCost);
  const legacyEnteredTotal = moneyToString(input.legacyEnteredTotal);

  const approvedCos = input.changeOrders.filter((c) => c.status === "APPROVED");
  const approvedCoSum = sumKnown(approvedCos.map((c) => c.sellAmount));
  const approvedChangeOrderValue = presentSum(
    approvedCoSum.sum,
    approvedCoSum.knownCount,
    approvedCos.length
  );

  const pendingCos = input.changeOrders.filter((c) => PENDING_CO_STATUSES.has(c.status));
  const pendingCoSum = sumKnown(pendingCos.map((c) => c.sellAmount));
  const pendingChangeOrderValue = presentSum(
    pendingCoSum.sum,
    pendingCoSum.knownCount,
    pendingCos.length
  );

  const pendingChanges = input.changes.filter((c) => PENDING_CHANGE_STATUSES.has(c.status));
  const pendingSellSum = sumKnown(pendingChanges.map((c) => c.sellImpact));
  const pendingProposedSellValue = presentSum(
    pendingSellSum.sum,
    pendingSellSum.knownCount,
    pendingChanges.length
  );

  const revisedContractValueComplete =
    originalContractValue != null && approvedCoSum.unknownCount === 0;
  let revisedContractValue: string | null = null;
  if (originalContractValue != null) {
    if (approvedCos.length === 0) {
      revisedContractValue = originalContractValue;
    } else if (approvedCoSum.knownCount === 0) {
      // Original known but every approved CO amount unknown — do not invent a revised total.
      revisedContractValue = null;
    } else {
      // Known CO amounts only; unknownCount > 0 ⇒ incomplete (partial sum exposed).
      revisedContractValue = moneyToString(
        new PrismaNS.Decimal(originalContractValue).add(approvedCoSum.sum!)
      );
    }
  }

  const approvedChanges = input.changes.filter((c) => c.status === "APPROVED");
  const approvedCostSum = sumKnown(approvedChanges.map((c) => c.costImpact));
  const approvedChangeEstimatedCost = presentSum(
    approvedCostSum.sum,
    approvedCostSum.knownCount,
    approvedChanges.length
  );

  const currentEstimatedCostComplete =
    originalEstimatedCost != null && approvedCostSum.unknownCount === 0;
  let currentEstimatedCost: string | null = null;
  if (originalEstimatedCost != null) {
    if (approvedChanges.length === 0) {
      currentEstimatedCost = originalEstimatedCost;
    } else if (approvedCostSum.knownCount === 0) {
      currentEstimatedCost = null;
    } else {
      currentEstimatedCost = moneyToString(
        new PrismaNS.Decimal(originalEstimatedCost).add(approvedCostSum.sum!)
      );
    }
  }

  const committedPos = input.purchaseOrders.filter((p) => COMMITTED_PO_STATUSES.has(p.status));
  const poSum = sumKnown(committedPos.map((p) => p.amount));
  const purchaseOrderCommittedValue = presentSum(poSum.sum, poSum.knownCount, committedPos.length);

  const actualItems = input.procurementItems.filter((i) => i.status !== "CANCELLED");
  let actualSum: Prisma.Decimal | null = null;
  let knownProcurementActualCount = 0;
  for (const item of actualItems) {
    const d = toDecimal(item.actualCost);
    if (d == null) continue;
    knownProcurementActualCount += 1;
    actualSum = actualSum == null ? d : actualSum.add(d);
  }
  const knownProcurementActualCost =
    knownProcurementActualCount === 0 ? null : moneyToString(actualSum);

  let estimatedGrossProfit: string | null = null;
  let estimatedGrossMarginPercent: string | null = null;
  if (
    revisedContractValueComplete &&
    currentEstimatedCostComplete &&
    revisedContractValue != null &&
    currentEstimatedCost != null
  ) {
    const revenue = new PrismaNS.Decimal(revisedContractValue);
    const cost = new PrismaNS.Decimal(currentEstimatedCost);
    const profit = revenue.sub(cost);
    estimatedGrossProfit = moneyToString(profit);
    if (!revenue.isZero()) {
      estimatedGrossMarginPercent = profit.div(revenue).mul(100).toFixed(2);
    }
  }

  return {
    originalContractValue,
    approvedChangeOrderValue,
    approvedChangeOrderKnownCount: approvedCoSum.knownCount,
    approvedChangeOrderUnknownCount: approvedCoSum.unknownCount,
    revisedContractValue,
    revisedContractValueComplete,
    pendingProposedSellValue,
    pendingProposedSellUnknownCount: pendingSellSum.unknownCount,
    pendingChangeOrderValue,
    pendingChangeOrderUnknownCount: pendingCoSum.unknownCount,
    originalEstimatedCost,
    approvedChangeEstimatedCost,
    approvedChangeCostKnownCount: approvedCostSum.knownCount,
    approvedChangeCostUnknownCount: approvedCostSum.unknownCount,
    currentEstimatedCost,
    currentEstimatedCostComplete,
    purchaseOrderCommittedValue,
    purchaseOrderCommittedKnownCount: poSum.knownCount,
    purchaseOrderUnknownCount: poSum.unknownCount,
    knownProcurementActualCost,
    knownProcurementActualCount,
    estimatedGrossProfit,
    estimatedGrossMarginPercent,
    estimatedFabricationHours: totalEstimatedHours(input.fabricationItems),
    legacyEnteredTotal,
  };
}

export async function buildJobFinancialSnapshot(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string }
): Promise<JobFinancialSnapshot | null> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: {
      originalContractValue: true,
      originalEstimatedCost: true,
      totalCost: true,
    },
  });
  if (!job) return null;

  const [changeOrders, changes, purchaseOrders, procurementItems, fabricationItems] =
    await Promise.all([
      prisma.jobChangeOrder.findMany({
        where: { workspaceId: input.workspaceId, jobId: input.jobId },
        select: { status: true, sellAmount: true },
      }),
      prisma.jobChange.findMany({
        where: { workspaceId: input.workspaceId, jobId: input.jobId },
        select: { status: true, sellImpact: true, costImpact: true },
      }),
      prisma.jobPurchaseOrder.findMany({
        where: { workspaceId: input.workspaceId, jobId: input.jobId },
        select: { status: true, amount: true },
      }),
      prisma.jobProcurementItem.findMany({
        where: { workspaceId: input.workspaceId, jobId: input.jobId },
        select: { status: true, actualCost: true },
      }),
      prisma.jobFabricationItem.findMany({
        where: { workspaceId: input.workspaceId, jobId: input.jobId },
        select: { quantity: true, estimatedHoursPerPiece: true },
      }),
    ]);

  return computeJobFinancialSnapshot({
    originalContractValue: job.originalContractValue,
    originalEstimatedCost: job.originalEstimatedCost,
    legacyEnteredTotal: job.totalCost,
    changeOrders,
    changes,
    purchaseOrders,
    procurementItems,
    fabricationItems: fabricationItems.map((f) => ({
      quantity: Number(f.quantity.toString()),
      estimatedHoursPerPiece: Number(f.estimatedHoursPerPiece.toString()),
    })),
  });
}
