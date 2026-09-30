import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  allowedStatusTransitions,
  BillingError,
  computeBillingSnapshot,
  createInvoice,
  deleteInvoice,
  listPeriodDeliveries,
  moneyToString,
  normalizeMoney,
  presentInvoice,
  toUtcDateOnly,
  updateInvoice,
} from "../application/services/job-billing.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("job billing", () => {
  it("treats NULL amount as unknown and rejects negatives; 0 is explicit", () => {
    expect(normalizeMoney(null)).toBeNull();
    expect(moneyToString(normalizeMoney(0))).toBe("0.00");
    expect(moneyToString(normalizeMoney("150000.5"))).toBe("150000.50");
    expect(() => normalizeMoney(-100)).toThrow(/negative/);
  });

  it("stores dates as UTC midnight date-only", () => {
    expect(toUtcDateOnly(new Date("2026-09-30T00:00:00.000Z"))).toBe("2026-09-30");
  });

  it("defines status transitions without PAID", () => {
    expect(allowedStatusTransitions("DRAFT")).toEqual(["SUBMITTED", "VOID"]);
    expect(allowedStatusTransitions("SUBMITTED")).toEqual(["APPROVED", "REJECTED", "DRAFT", "VOID"]);
    expect(allowedStatusTransitions("APPROVED")).toEqual(["VOID"]);
    expect(allowedStatusTransitions("REJECTED")).toEqual(["DRAFT", "VOID"]);
    expect(allowedStatusTransitions("VOID")).toEqual([]);
  });

  it("computes total billed from SUBMITTED+APPROVED only; drafts/rejected/void excluded", () => {
    const snap = computeBillingSnapshot({
      invoices: [
        { status: "DRAFT", amount: { toString: () => "99999.00" } },
        { status: "SUBMITTED", amount: { toString: () => "100000.00" } },
        { status: "APPROVED", amount: { toString: () => "200000.00" } },
        { status: "REJECTED", amount: { toString: () => "50000.00" } },
        { status: "VOID", amount: { toString: () => "75000.00" } },
      ],
      financial: {
        revisedContractValue: "1245000.00",
        revisedContractValueComplete: true,
      },
    });
    expect(snap.totalBilled).toBe("300000.00");
    expect(snap.remainingToBill).toBe("945000.00");
    expect(snap.remainingToBillComplete).toBe(true);
    expect(snap.billingPercentOfRevisedContract).toBe("24.10");
    expect(snap.billingExceedsKnownContract).toBe(false);
    expect(snap.draftInvoiceValue).toBe("99999.00");
  });

  it("marks remaining incomplete when revised contract is incomplete", () => {
    const snap = computeBillingSnapshot({
      invoices: [{ status: "APPROVED", amount: { toString: () => "10000.00" } }],
      financial: {
        revisedContractValue: "100000.00",
        revisedContractValueComplete: false,
      },
    });
    expect(snap.remainingToBill).toBe("90000.00");
    expect(snap.remainingToBillComplete).toBe(false);
    expect(snap.billingPercentOfRevisedContract).toBeNull();
  });

  it("flags over-billing without clamping", () => {
    const snap = computeBillingSnapshot({
      invoices: [{ status: "APPROVED", amount: { toString: () => "150000.00" } }],
      financial: {
        revisedContractValue: "100000.00",
        revisedContractValueComplete: true,
      },
    });
    expect(snap.remainingToBill).toBe("-50000.00");
    expect(snap.billingExceedsKnownContract).toBe(true);
  });

  it("handles zero revised contract and negative CO effects via Phase H value", () => {
    const snap = computeBillingSnapshot({
      invoices: [{ status: "SUBMITTED", amount: { toString: () => "0.00" } }],
      financial: {
        revisedContractValue: "0.00",
        revisedContractValueComplete: true,
      },
    });
    expect(snap.totalBilled).toBe("0.00");
    expect(snap.remainingToBill).toBe("0.00");
    expect(snap.billingPercentOfRevisedContract).toBeNull();
  });

  it("tracks partial CO billing across invoices without mutating sellAmount", () => {
    const snap = computeBillingSnapshot({
      invoices: [
        {
          status: "APPROVED",
          amount: { toString: () => "150000.00" },
          changeOrderAllocations: [
            { changeOrderId: "co-2", amount: { toString: () => "20000.00" } },
          ],
        },
        {
          status: "SUBMITTED",
          amount: { toString: () => "80000.00" },
          changeOrderAllocations: [
            { changeOrderId: "co-2", amount: { toString: () => "30000.00" } },
          ],
        },
        {
          status: "DRAFT",
          amount: { toString: () => "10000.00" },
          changeOrderAllocations: [
            { changeOrderId: "co-2", amount: { toString: () => "9999.00" } },
          ],
        },
      ],
      financial: {
        revisedContractValue: "1250000.00",
        revisedContractValueComplete: true,
      },
      approvedChangeOrders: [
        { id: "co-2", number: "CO-02", sellAmount: { toString: () => "50000.00" } },
        { id: "co-3", number: "CO-03", sellAmount: null },
      ],
    });
    expect(snap.changeOrderBilled[0]?.billedToDate).toBe("50000.00");
    expect(snap.changeOrderBilled[0]?.remainingUnbilled).toBe("0.00");
    expect(snap.changeOrderBilled[1]?.approvedSellAmount).toBeNull();
    expect(snap.changeOrderBilled[1]?.remainingComplete).toBe(false);
  });

  it("creates a draft invoice with period and CO allocations", async () => {
    const created = {
      id: "inv-1",
      jobId: "job-1",
      invoiceNumber: "1027",
      billingPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
      billingPeriodEnd: new Date("2026-09-30T00:00:00.000Z"),
      invoiceDate: new Date("2026-09-25T00:00:00.000Z"),
      dueDate: null,
      status: "DRAFT" as const,
      amount: { toString: () => "150000.00" },
      billToCustomerId: null,
      documentRecordId: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      billToCustomer: null,
      documentRecord: null,
      changeOrderAllocations: [
        {
          id: "a1",
          changeOrderId: "co-1",
          amount: null,
          notes: null,
          changeOrder: {
            id: "co-1",
            number: "CO-02",
            title: "Extra",
            status: "APPROVED",
            sellAmount: { toString: () => "50000.00" },
          },
        },
      ],
    };
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobInvoice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findFirstOrThrow: vi.fn().mockResolvedValue(created),
      },
      jobChangeOrder: { findMany: vi.fn().mockResolvedValue([{ id: "co-1" }]) },
      customer: { findFirst: vi.fn() },
      jobDocumentRecord: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobInvoice: {
            create: vi.fn().mockResolvedValue({ id: "inv-1" }),
            findFirstOrThrow: vi.fn().mockResolvedValue(created),
          },
          jobInvoiceChangeOrderAllocation: {
            deleteMany: vi.fn(),
            create: vi.fn(),
          },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };

    const dto = await createInvoice(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      actorUserId: "u1",
      invoiceNumber: "1027",
      invoiceDate: "2026-09-25",
      billingPeriodStart: "2026-09-01",
      billingPeriodEnd: "2026-09-30",
      amount: 150000,
      changeOrderAllocations: [{ changeOrderId: "co-1" }],
    });
    expect(dto.invoiceNumber).toBe("1027");
    expect(dto.amount).toBe("150000.00");
    expect(dto.billingPeriodStart).toBe("2026-09-01");
    expect(dto.changeOrderAllocations[0]?.changeOrderNumber).toBe("CO-02");
  });

  it("rejects period start after end", async () => {
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobInvoice: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      createInvoice(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        actorUserId: "u1",
        invoiceNumber: "1",
        invoiceDate: "2026-09-25",
        billingPeriodStart: "2026-09-30",
        billingPeriodEnd: "2026-09-01",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires amount before submit and protects approved from edit", async () => {
    const draft = {
      id: "inv-1",
      workspaceId: "ws",
      jobId: "job-1",
      invoiceNumber: "1027",
      billingPeriodStart: null,
      billingPeriodEnd: null,
      invoiceDate: new Date("2026-09-25T00:00:00.000Z"),
      dueDate: null,
      status: "DRAFT" as const,
      amount: null,
      billToCustomerId: null,
      documentRecordId: null,
      notes: null,
    };
    const prismaSubmit = {
      jobInvoice: { findFirst: vi.fn().mockResolvedValue(draft) },
    };
    await expect(
      updateInvoice(prismaSubmit as never, {
        workspaceId: "ws",
        jobId: "job-1",
        invoiceId: "inv-1",
        actorUserId: "u1",
        status: "SUBMITTED",
      })
    ).rejects.toMatchObject({ message: expect.stringMatching(/Amount is required/) });

    const approved = { ...draft, status: "APPROVED" as const, amount: { toString: () => "1.00" } };
    const prismaApproved = {
      jobInvoice: { findFirst: vi.fn().mockResolvedValue(approved) },
    };
    await expect(
      updateInvoice(prismaApproved as never, {
        workspaceId: "ws",
        jobId: "job-1",
        invoiceId: "inv-1",
        actorUserId: "u1",
        amount: 2,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("deletes draft only", async () => {
    const prisma = {
      jobInvoice: {
        findFirst: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "SUBMITTED",
          invoiceNumber: "1027",
        }),
      },
    };
    await expect(
      deleteInvoice(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        invoiceId: "inv-1",
        actorUserId: "u1",
      })
    ).rejects.toBeInstanceOf(BillingError);
  });

  it("lists period deliveries by actualDeliveryDate only", async () => {
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobShipment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "s1",
            deliveryNumber: "DEL-003",
            actualDeliveryDate: new Date("2026-09-07T00:00:00.000Z"),
            status: "DELIVERED",
            items: [
              {
                workPackage: { name: "Area A" },
                fabricationItem: { name: "Beams" },
              },
            ],
          },
        ]),
      },
    };
    const rows = await listPeriodDeliveries(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveryNumber).toBe("DEL-003");
    expect(prisma.jobShipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actualDeliveryDate: {
            gte: new Date("2026-09-01T00:00:00.000Z"),
            lte: new Date("2026-09-30T00:00:00.000Z"),
          },
        }),
      })
    );
  });

  it("presents invoice without inventing paid/balance fields", () => {
    const dto = presentInvoice({
      id: "inv-1",
      jobId: "job-1",
      invoiceNumber: "APP-05",
      billingPeriodStart: null,
      billingPeriodEnd: null,
      invoiceDate: new Date("2026-09-25T00:00:00.000Z"),
      dueDate: null,
      status: "SUBMITTED",
      amount: { toString: () => "100.00" },
      billToCustomerId: null,
      documentRecordId: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      changeOrderAllocations: [],
    });
    expect(dto).not.toHaveProperty("paid");
    expect(dto).not.toHaveProperty("balanceDue");
    expect(JSON.stringify(dto)).not.toContain("PAID");
  });

  it("wires Phase I without payments, AR, AIA, AI, or Phase H mutation", () => {
    const service = readFileSync(
      resolve(here, "../application/services/job-billing.ts"),
      "utf8"
    );
    const migration = readFileSync(
      resolve(
        here,
        "../../../../packages/db/prisma/migrations/20260930220000_job_billing_invoices/migration.sql"
      ),
      "utf8"
    );
    expect(service).toContain("computeBillingSnapshot");
    expect(service).toContain("BILLED_STATUSES");
    expect(service).toContain("buildJobFinancialSnapshot");
    expect(service).not.toContain("PAID");
    expect(service).not.toContain("retainage");
    expect(service).not.toContain("G702");
    expect(service).not.toContain("JOB_MATCHER_AUTO_ASSIGN");
    expect(service).not.toContain("INLINE_IMAGE_AI_ANALYZE");
    expect(service).not.toContain("originalContractValue");
    expect(service).not.toContain("prisma.job.update");
    expect(service).not.toContain("jobChangeOrder.update");
    expect(migration).toContain("JobInvoice");
    expect(migration).toContain("JobInvoiceChangeOrderAllocation");
    expect(migration).not.toContain("PAID");
  });
});
