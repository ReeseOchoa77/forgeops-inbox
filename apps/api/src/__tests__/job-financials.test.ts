import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildJobFinancialSnapshot,
  computeJobFinancialSnapshot,
  moneyToString,
  normalizeMoney,
} from "../application/services/job-financials.js";

const here = dirname(fileURLToPath(import.meta.url));

function baseInput(
  overrides: Partial<Parameters<typeof computeJobFinancialSnapshot>[0]> = {}
) {
  return {
    originalContractValue: null,
    originalEstimatedCost: null,
    legacyEnteredTotal: null,
    changeOrders: [],
    changes: [],
    purchaseOrders: [],
    procurementItems: [],
    fabricationItems: [],
    ...overrides,
  };
}

describe("job financials", () => {
  it("treats NULL money as unknown and 0 as explicit zero with Decimal precision", () => {
    expect(normalizeMoney(null)).toBeNull();
    expect(moneyToString(normalizeMoney(0))).toBe("0.00");
    expect(moneyToString(normalizeMoney("1200000.5"))).toBe("1200000.50");
    expect(moneyToString(normalizeMoney(-8500))).toBe("-8500.00");
  });

  it("keeps original contract null vs zero distinct", () => {
    const unknown = computeJobFinancialSnapshot(baseInput());
    expect(unknown.originalContractValue).toBeNull();
    expect(unknown.revisedContractValue).toBeNull();
    expect(unknown.revisedContractValueComplete).toBe(false);

    const zero = computeJobFinancialSnapshot(
      baseInput({ originalContractValue: 0 })
    );
    expect(zero.originalContractValue).toBe("0.00");
    expect(zero.revisedContractValue).toBe("0.00");
    expect(zero.revisedContractValueComplete).toBe(true);
  });

  it("keeps original estimated cost null vs zero distinct", () => {
    const unknown = computeJobFinancialSnapshot(baseInput());
    expect(unknown.originalEstimatedCost).toBeNull();
    expect(unknown.currentEstimatedCost).toBeNull();
    expect(unknown.currentEstimatedCostComplete).toBe(false);

    const zero = computeJobFinancialSnapshot(
      baseInput({ originalEstimatedCost: 0 })
    );
    expect(zero.originalEstimatedCost).toBe("0.00");
    expect(zero.currentEstimatedCost).toBe("0.00");
    expect(zero.currentEstimatedCostComplete).toBe(true);
  });

  it("sums approved CO sell amounts including credits; excludes proposed/rejected", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        originalContractValue: 1_200_000,
        changeOrders: [
          { status: "APPROVED", sellAmount: 45_000 },
          { status: "APPROVED", sellAmount: -8_500 },
          { status: "SUBMITTED", sellAmount: 18_500 },
          { status: "DRAFT", sellAmount: 1_000 },
          { status: "REJECTED", sellAmount: 99_000 },
          { status: "VOID", sellAmount: 50_000 },
        ],
      })
    );
    expect(snap.approvedChangeOrderValue).toBe("36500.00");
    expect(snap.revisedContractValue).toBe("1236500.00");
    expect(snap.revisedContractValueComplete).toBe(true);
    expect(snap.pendingChangeOrderValue).toBe("19500.00");
  });

  it("marks revised contract incomplete when an approved CO has null sellAmount", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        originalContractValue: 100_000,
        changeOrders: [
          { status: "APPROVED", sellAmount: 10_000 },
          { status: "APPROVED", sellAmount: null },
        ],
      })
    );
    expect(snap.approvedChangeOrderValue).toBe("10000.00");
    expect(snap.approvedChangeOrderUnknownCount).toBe(1);
    expect(snap.revisedContractValue).toBe("110000.00");
    expect(snap.revisedContractValueComplete).toBe(false);
  });

  it("does not invent revised contract when all approved CO amounts are unknown", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        originalContractValue: 100_000,
        changeOrders: [{ status: "APPROVED", sellAmount: null }],
      })
    );
    expect(snap.approvedChangeOrderValue).toBeNull();
    expect(snap.revisedContractValue).toBeNull();
    expect(snap.revisedContractValueComplete).toBe(false);
  });

  it("does not double-count Change.sellImpact into approved revenue", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        originalContractValue: 100_000,
        changeOrders: [{ status: "APPROVED", sellAmount: 10_000 }],
        changes: [
          { status: "APPROVED", sellImpact: 6_000, costImpact: 3_000 },
          { status: "APPROVED", sellImpact: 4_000, costImpact: 2_000 },
        ],
      })
    );
    // Revenue from CO only (+10k), not +10k + sellImpacts.
    expect(snap.approvedChangeOrderValue).toBe("10000.00");
    expect(snap.revisedContractValue).toBe("110000.00");
    // Cost from approved Changes' costImpact.
    expect(snap.approvedChangeEstimatedCost).toBe("5000.00");
  });

  it("includes APPROVED Change costImpact and excludes unapproved; supports credits", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        originalEstimatedCost: 900_000,
        changes: [
          { status: "APPROVED", sellImpact: null, costImpact: 28_000 },
          { status: "APPROVED", sellImpact: null, costImpact: -4_000 },
          { status: "PROPOSED", sellImpact: 18_500, costImpact: 12_000 },
          { status: "PRICING", sellImpact: 1_000, costImpact: 500 },
          { status: "REJECTED", sellImpact: null, costImpact: 9_999 },
          { status: "IDENTIFIED", sellImpact: null, costImpact: 1 },
        ],
      })
    );
    expect(snap.approvedChangeEstimatedCost).toBe("24000.00");
    expect(snap.currentEstimatedCost).toBe("924000.00");
    expect(snap.currentEstimatedCostComplete).toBe(true);
    expect(snap.pendingProposedSellValue).toBe("19500.00");
  });

  it("marks current estimated cost incomplete when approved costImpact is null", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        originalEstimatedCost: 100_000,
        changes: [
          { status: "APPROVED", sellImpact: null, costImpact: 5_000 },
          { status: "APPROVED", sellImpact: null, costImpact: null },
        ],
      })
    );
    expect(snap.approvedChangeCostUnknownCount).toBe(1);
    expect(snap.currentEstimatedCost).toBe("105000.00");
    expect(snap.currentEstimatedCostComplete).toBe(false);
  });

  it("computes estimated gross profit and margin only when both sides are complete", () => {
    const complete = computeJobFinancialSnapshot(
      baseInput({
        originalContractValue: 1_245_000,
        originalEstimatedCost: 928_000,
      })
    );
    expect(complete.estimatedGrossProfit).toBe("317000.00");
    expect(complete.estimatedGrossMarginPercent).toBe("25.46");

    const incomplete = computeJobFinancialSnapshot(
      baseInput({
        originalContractValue: 1_245_000,
        originalEstimatedCost: null,
      })
    );
    expect(incomplete.estimatedGrossProfit).toBeNull();
    expect(incomplete.estimatedGrossMarginPercent).toBeNull();
  });

  it("handles zero contract denominator and negative margin", () => {
    const zeroRev = computeJobFinancialSnapshot(
      baseInput({
        originalContractValue: 0,
        originalEstimatedCost: 10_000,
      })
    );
    expect(zeroRev.estimatedGrossProfit).toBe("-10000.00");
    expect(zeroRev.estimatedGrossMarginPercent).toBeNull();

    const neg = computeJobFinancialSnapshot(
      baseInput({
        originalContractValue: 100_000,
        originalEstimatedCost: 120_000,
      })
    );
    expect(neg.estimatedGrossProfit).toBe("-20000.00");
    expect(neg.estimatedGrossMarginPercent).toBe("-20.00");
  });

  it("commits ISSUED/PARTIALLY_RECEIVED/RECEIVED PO amounts; excludes draft/cancelled", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        purchaseOrders: [
          { status: "ISSUED", amount: 100_000 },
          { status: "PARTIALLY_RECEIVED", amount: 50_000 },
          { status: "RECEIVED", amount: 25_000 },
          { status: "DRAFT", amount: 999_999 },
          { status: "CANCELLED", amount: 888_888 },
          { status: "ISSUED", amount: null },
        ],
      })
    );
    expect(snap.purchaseOrderCommittedValue).toBe("175000.00");
    expect(snap.purchaseOrderUnknownCount).toBe(1);
  });

  it("exposes known procurement actualCost without adding it to PO commitments", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        purchaseOrders: [{ status: "ISSUED", amount: 410_000 }],
        procurementItems: [
          { status: "RECEIVED", actualCost: 200_000 },
          { status: "ORDERED", actualCost: 50_000 },
          { status: "CANCELLED", actualCost: 9_999 },
          { status: "NEEDED", actualCost: null },
        ],
      })
    );
    expect(snap.purchaseOrderCommittedValue).toBe("410000.00");
    expect(snap.knownProcurementActualCost).toBe("250000.00");
    expect(snap.knownProcurementActualCount).toBe(2);
    // Prove not additive: 410k + 250k must not appear as a single total field.
    expect(JSON.stringify(snap)).not.toContain("660000");
  });

  it("exposes estimated fabrication hours without inventing a labor rate", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        fabricationItems: [
          { quantity: 10, estimatedHoursPerPiece: 2.5 },
          { quantity: 4, estimatedHoursPerPiece: 5 },
        ],
      })
    );
    expect(snap.estimatedFabricationHours).toBe(45);
  });

  it("preserves legacyEnteredTotal without using it in derived financials", () => {
    const snap = computeJobFinancialSnapshot(
      baseInput({
        legacyEnteredTotal: 428_750,
        originalContractValue: 1_200_000,
        originalEstimatedCost: 900_000,
      })
    );
    expect(snap.legacyEnteredTotal).toBe("428750.00");
    expect(snap.revisedContractValue).toBe("1200000.00");
    expect(snap.currentEstimatedCost).toBe("900000.00");
  });

  it("buildJobFinancialSnapshot loads lean selects and does not mutate operational records", async () => {
    const jobUpdate = vi.fn();
    const changeUpdate = vi.fn();
    const prisma = {
      job: {
        findFirst: vi.fn().mockResolvedValue({
          originalContractValue: { toString: () => "100000.00" },
          originalEstimatedCost: { toString: () => "80000.00" },
          totalCost: { toString: () => "99999.00" },
        }),
        update: jobUpdate,
      },
      jobChangeOrder: {
        findMany: vi.fn().mockResolvedValue([
          { status: "APPROVED", sellAmount: { toString: () => "10000.00" } },
        ]),
        update: vi.fn(),
      },
      jobChange: {
        findMany: vi.fn().mockResolvedValue([
          {
            status: "APPROVED",
            sellImpact: { toString: () => "6000.00" },
            costImpact: { toString: () => "3000.00" },
          },
        ]),
        update: changeUpdate,
      },
      jobPurchaseOrder: {
        findMany: vi.fn().mockResolvedValue([
          { status: "ISSUED", amount: { toString: () => "20000.00" } },
        ]),
      },
      jobProcurementItem: {
        findMany: vi.fn().mockResolvedValue([
          { status: "RECEIVED", actualCost: { toString: () => "15000.00" } },
        ]),
      },
      jobFabricationItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            quantity: { toString: () => "2" },
            estimatedHoursPerPiece: { toString: () => "3" },
          },
        ]),
      },
      jobShipment: { findMany: vi.fn(), update: vi.fn() },
      jobMilestone: { findMany: vi.fn(), update: vi.fn() },
      jobWorkPackage: { findMany: vi.fn(), update: vi.fn() },
    };

    const snap = await buildJobFinancialSnapshot(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
    });
    expect(snap?.revisedContractValue).toBe("110000.00");
    expect(snap?.currentEstimatedCost).toBe("83000.00");
    expect(snap?.purchaseOrderCommittedValue).toBe("20000.00");
    expect(snap?.knownProcurementActualCost).toBe("15000.00");
    expect(snap?.estimatedFabricationHours).toBe(6);
    expect(snap?.legacyEnteredTotal).toBe("99999.00");
    expect(jobUpdate).not.toHaveBeenCalled();
    expect(changeUpdate).not.toHaveBeenCalled();
    expect(prisma.jobShipment.update).not.toHaveBeenCalled();
    expect(prisma.jobMilestone.update).not.toHaveBeenCalled();
    expect(prisma.jobWorkPackage.update).not.toHaveBeenCalled();
  });

  it("wires Phase H without AI gates, invoices, or Job.totalCost mutation in the service", () => {
    const service = readFileSync(
      resolve(here, "../application/services/job-financials.ts"),
      "utf8"
    );
    const migration = readFileSync(
      resolve(
        here,
        "../../../../packages/db/prisma/migrations/20260930210000_job_financial_foundation/migration.sql"
      ),
      "utf8"
    );
    expect(service).toContain("computeJobFinancialSnapshot");
    expect(service).toContain("originalContractValue");
    expect(service).toContain("originalEstimatedCost");
    expect(service).not.toContain("createInvoice");
    expect(service).not.toContain("JobInvoice");
    expect(service).not.toContain("JOB_MATCHER_AUTO_ASSIGN");
    expect(service).not.toContain("INLINE_IMAGE_AI_ANALYZE");
    expect(service).not.toContain("prisma.job.update");
    expect(migration).toContain('"originalContractValue" DECIMAL(14,2)');
    expect(migration).toContain('"originalEstimatedCost" DECIMAL(14,2)');
    expect(migration).toContain("ORIGINAL_CONTRACT_VALUE_UPDATED");
    expect(migration).not.toContain('UPDATE "totalCost"');
    expect(migration).not.toContain("SET \"originalContractValue\"");
    expect(migration).toContain("No backfill");
  });
});
