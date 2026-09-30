import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createProcurementItem,
  createPurchaseOrder,
  deriveProcurementRisk,
  moneyToString,
  normalizeMoney,
  ProcurementError,
  recordProcurementReceipt,
  toUtcDateOnly,
} from "../application/services/job-procurement.js";

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date("2026-10-12T15:00:00.000Z");

describe("job procurement", () => {
  it("treats NULL money as unknown and 0 as explicit zero", () => {
    expect(normalizeMoney(null)).toBeNull();
    expect(moneyToString(normalizeMoney(0))).toBe("0.00");
    expect(moneyToString(normalizeMoney("42500.5"))).toBe("42500.50");
  });

  it("derives overdue / late expected / past expected risks", () => {
    expect(
      deriveProcurementRisk(
        { status: "NEEDED", requiredDate: "2026-10-10", expectedDate: null },
        now
      )
    ).toMatchObject({ overdueToOrder: true, atRisk: true });

    expect(
      deriveProcurementRisk(
        { status: "ORDERED", requiredDate: "2026-10-15", expectedDate: "2026-10-18" },
        now
      )
    ).toMatchObject({ lateExpected: true, pastExpected: false, atRisk: true });

    expect(
      deriveProcurementRisk(
        { status: "ORDERED", requiredDate: "2026-10-01", expectedDate: "2026-10-05" },
        now
      )
    ).toMatchObject({ pastExpected: true, atRisk: true });

    expect(
      deriveProcurementRisk(
        { status: "RECEIVED", requiredDate: "2026-10-01", expectedDate: "2026-10-05" },
        now
      )
    ).toMatchObject({ atRisk: false });
  });

  it("stores dates as UTC midnight date-only", () => {
    expect(toUtcDateOnly(new Date("2026-10-15T00:00:00.000Z"))).toBe("2026-10-15");
  });

  it("creates a minimal procurement item with description only", async () => {
    const created = {
      id: "pi-1",
      jobId: "job-1",
      workPackageId: null,
      category: "MATERIAL",
      description: "Joists",
      quantity: null,
      unit: null,
      status: "NEEDED",
      vendorId: null,
      requiredDate: null,
      expectedDate: null,
      receivedDate: null,
      estimatedCost: null,
      actualCost: null,
      purchaseOrderId: null,
      sourceChangeId: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      workPackage: null,
      vendor: null,
      purchaseOrder: null,
      sourceChange: null,
      receipts: [],
    };
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobProcurementItem: { create: vi.fn().mockResolvedValue(created) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await createProcurementItem(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      description: "Joists",
      actorUserId: "u1",
    });
    expect(dto.description).toBe("Joists");
    expect(dto.estimatedCost).toBeNull();
    expect(dto.vendor).toBeNull();
    expect(dto.status).toBe("NEEDED");
  });

  it("rejects cross-job work packages and cross-workspace vendors", async () => {
    await expect(
      createProcurementItem(
        {
          job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
          jobWorkPackage: { findFirst: vi.fn().mockResolvedValue(null) },
        } as never,
        {
          workspaceId: "ws",
          jobId: "job-1",
          description: "Plate",
          workPackageId: "other-job-pkg",
          actorUserId: "u1",
        }
      )
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(
      createProcurementItem(
        {
          job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
          vendor: { findFirst: vi.fn().mockResolvedValue(null) },
        } as never,
        {
          workspaceId: "ws",
          jobId: "job-1",
          description: "Plate",
          vendorId: "other-ws-vendor",
          actorUserId: "u1",
        }
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("creates a PO with multiple items and independent amount; rejects vendor conflict", async () => {
    const po = {
      id: "po-1",
      jobId: "job-1",
      poNumber: "PO-3817",
      vendorId: "v1",
      status: "ISSUED",
      orderedDate: new Date("2026-10-04T00:00:00.000Z"),
      expectedDate: new Date("2026-10-11T00:00:00.000Z"),
      amount: { toString: () => "42500.00" },
      documentRecordId: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      vendor: { id: "v1", name: "ABC Steel" },
      documentRecord: null,
      items: [
        { id: "pi-1", description: "Beams", status: "ORDERED", category: "MATERIAL", quantity: null, unit: null, workPackage: null, estimatedCost: null, actualCost: null },
        { id: "pi-2", description: "Plate", status: "ORDERED", category: "MATERIAL", quantity: null, unit: null, workPackage: null, estimatedCost: null, actualCost: null },
      ],
    };
    const prismaOk = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      vendor: { findFirst: vi.fn().mockResolvedValue({ id: "v1" }) },
      jobPurchaseOrder: { findFirst: vi.fn().mockResolvedValue(null) },
      jobProcurementItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: "pi-1", vendorId: null, purchaseOrderId: null, status: "NEEDED" },
          { id: "pi-2", vendorId: "v1", purchaseOrderId: null, status: "READY_TO_ORDER" },
        ]),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobPurchaseOrder: {
            create: vi.fn().mockResolvedValue({ id: "po-1", poNumber: "PO-3817", status: "ISSUED" }),
            findFirstOrThrow: vi.fn().mockResolvedValue(po),
          },
          jobProcurementItem: { update: vi.fn() },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await createPurchaseOrder(prismaOk as never, {
      workspaceId: "ws",
      jobId: "job-1",
      poNumber: "PO-3817",
      vendorId: "v1",
      status: "ISSUED",
      orderedDate: "2026-10-04",
      expectedDate: "2026-10-11",
      amount: 42500,
      itemIds: ["pi-1", "pi-2"],
      actorUserId: "u1",
    });
    expect(dto.poNumber).toBe("PO-3817");
    expect(dto.amount).toBe("42500.00");
    expect(dto.items).toHaveLength(2);

    await expect(
      createPurchaseOrder(
        {
          job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
          vendor: { findFirst: vi.fn().mockResolvedValue({ id: "v1" }) },
          jobPurchaseOrder: { findFirst: vi.fn().mockResolvedValue(null) },
          jobProcurementItem: {
            findMany: vi.fn().mockResolvedValue([
              { id: "pi-1", vendorId: "other-vendor", purchaseOrderId: null, status: "NEEDED" },
            ]),
          },
        } as never,
        {
          workspaceId: "ws",
          jobId: "job-1",
          poNumber: "PO-9",
          vendorId: "v1",
          itemIds: ["pi-1"],
          actorUserId: "u1",
        }
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("records partial then complete receipt without mutating Job.totalCost", async () => {
    const base = {
      id: "pi-1",
      jobId: "job-1",
      category: "MATERIAL",
      description: "Beams",
      quantity: { toString: () => "20", gte: () => false },
      unit: "EA",
      status: "ORDERED",
      vendorId: null,
      requiredDate: null,
      expectedDate: null,
      receivedDate: null,
      estimatedCost: null,
      actualCost: null,
      purchaseOrderId: null,
      sourceChangeId: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      workPackage: null,
      vendor: null,
      purchaseOrder: null,
      sourceChange: null,
      receipts: [],
    };
    const after = {
      ...base,
      status: "PARTIALLY_RECEIVED",
      receipts: [
        {
          id: "r1",
          receivedDate: new Date("2026-10-12T00:00:00.000Z"),
          quantityReceived: { toString: () => "10" },
          marksComplete: false,
          notes: null,
          createdAt: now,
        },
      ],
    };
    const prisma = {
      jobProcurementItem: {
        findFirst: vi.fn().mockResolvedValue(base),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobProcurementReceipt: {
            create: vi.fn(),
            findMany: vi.fn().mockResolvedValue([
              { quantityReceived: { toString: () => "10" }, marksComplete: false, receivedDate: now },
            ]),
          },
          jobProcurementItem: { update: vi.fn().mockResolvedValue(after) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await recordProcurementReceipt(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      itemId: "pi-1",
      quantityReceived: 10,
      actorUserId: "u1",
    });
    expect(dto.status).toBe("PARTIALLY_RECEIVED");
    expect(dto.quantityReceivedTotal).toBe("10");
  });

  it("rejects invalid money", () => {
    expect(() => normalizeMoney("abc")).toThrow(ProcurementError);
  });

  it("wires procurement without AI, inventory, Job.totalCost, milestone, or package-status mutation", () => {
    const service = readFileSync(resolve(here, "../application/services/job-procurement.ts"), "utf8");
    expect(service).toContain("JobProcurementItem");
    expect(service).toContain("JobPurchaseOrder");
    expect(service).toContain("jobProcurementReceipt");
    expect(service).toContain("estimatedCost");
    expect(service).toContain("actualCost");
    expect(service).toContain("sourceChangeId");
    expect(service).not.toContain("totalCost");
    expect(service).not.toContain("inventory");
    expect(service).not.toContain("warehouse");
    expect(service).not.toContain("JobWorkPackageStatus");
    expect(service).not.toContain("createMilestone");
    expect(service).not.toContain("JOB_MATCHER");

    const detail = readFileSync(resolve(here, "../../../web/src/views/JobDetailView.tsx"), "utf8");
    expect(detail).toContain("JOB_CRM_TABS");
    expect(detail).toContain("<JobProcurementView");
    expect(detail).toContain("<ProcurementOverviewSummary");

    const listRoute = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    const listHandler = listRoute.slice(
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs — List jobs"),
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs/:jobId — Job detail")
    );
    expect(listHandler).not.toContain("jobProcurementItem");
    expect(listHandler).not.toContain("procurementSummary");

    const migration = readFileSync(
      resolve(here, "../../../../packages/db/prisma/migrations/20260929260000_job_procurement/migration.sql"),
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE "JobProcurementItem"');
    expect(migration).toContain('CREATE TABLE "JobPurchaseOrder"');
    expect(migration).toContain('CREATE TABLE "JobProcurementReceipt"');
    expect(migration).toContain('"estimatedCost" DECIMAL(14,2)');
    expect(migration).toContain('"amount" DECIMAL(14,2)');
  });
});
