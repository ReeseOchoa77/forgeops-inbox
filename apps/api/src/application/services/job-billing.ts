import type { JobInvoiceStatus, Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { safeDateOrNull } from "@forgeops/shared";
import {
  buildJobFinancialSnapshot,
  moneyToString as financialMoneyToString,
  type JobFinancialSnapshot,
} from "./job-financials.js";

/**
 * Phase I — Project billing / invoice tracking.
 *
 * Explicit invoice amounts. Total billed = SUBMITTED + APPROVED (known amounts).
 * Reuses Phase H revised contract. Does not track payments/AR.
 * Does not mutate contract baselines, COs, shipments, packages, or fabrication.
 */

export class BillingError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export const INVOICE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "VOID",
] as const satisfies readonly JobInvoiceStatus[];

/** Statuses that count toward Total Billed (billing actually sent/requested). */
export const BILLED_STATUSES = new Set<JobInvoiceStatus>(["SUBMITTED", "APPROVED"]);

const EDITABLE_STATUSES = new Set<JobInvoiceStatus>(["DRAFT", "REJECTED"]);

export type StatusTransition = {
  from: JobInvoiceStatus;
  to: JobInvoiceStatus;
  activity: "INVOICE_SUBMITTED" | "INVOICE_APPROVED" | "INVOICE_REJECTED" | "INVOICE_VOIDED" | "INVOICE_UPDATED";
};

export function allowedStatusTransitions(from: JobInvoiceStatus): JobInvoiceStatus[] {
  switch (from) {
    case "DRAFT":
      return ["SUBMITTED", "VOID"];
    case "SUBMITTED":
      return ["APPROVED", "REJECTED", "DRAFT", "VOID"];
    case "APPROVED":
      return ["VOID"];
    case "REJECTED":
      return ["DRAFT", "VOID"];
    case "VOID":
      return [];
    default:
      return [];
  }
}

export function activityForTransition(
  from: JobInvoiceStatus,
  to: JobInvoiceStatus
): StatusTransition["activity"] {
  if (to === "SUBMITTED") return "INVOICE_SUBMITTED";
  if (to === "APPROVED") return "INVOICE_APPROVED";
  if (to === "REJECTED") return "INVOICE_REJECTED";
  if (to === "VOID") return "INVOICE_VOIDED";
  return "INVOICE_UPDATED";
}

export function toUtcDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function normalizeDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const parsed = safeDateOrNull(raw);
  if (!parsed) throw new BillingError("Invalid date", 400);
  const ymd = toUtcDateOnly(parsed);
  if (!ymd) throw new BillingError("Invalid date", 400);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function normalizeMoney(raw: unknown): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new BillingError("Invalid money amount", 400);
  if (n < 0) throw new BillingError("Invoice amount cannot be negative (credit memos deferred)", 400);
  return new PrismaNS.Decimal(n.toFixed(2));
}

export function moneyToString(value: { toString(): string } | null | undefined): string | null {
  if (value == null) return null;
  return new PrismaNS.Decimal(value.toString()).toFixed(2);
}

function activityJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function assertJob(prisma: PrismaClient, workspaceId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, workspaceId },
    select: { id: true },
  });
  if (!job) throw new BillingError("Job not found", 404);
}

async function assertInvoiceNumberAvailable(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; invoiceNumber: string; excludeId?: string }
) {
  const existing = await prisma.jobInvoice.findFirst({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      invoiceNumber: input.invoiceNumber,
      status: { not: "VOID" },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw new BillingError("An active invoice with this number already exists on this job", 409);
}

async function assertBillTo(
  prisma: PrismaClient,
  workspaceId: string,
  billToCustomerId: string | null | undefined
) {
  if (!billToCustomerId) return;
  const row = await prisma.customer.findFirst({
    where: { id: billToCustomerId, workspaceId },
    select: { id: true },
  });
  if (!row) throw new BillingError("Bill-to customer not found in this workspace", 404);
}

async function assertDocument(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  documentRecordId: string | null | undefined
) {
  if (!documentRecordId) return;
  const row = await prisma.jobDocumentRecord.findFirst({
    where: { id: documentRecordId, workspaceId, jobId },
    select: { id: true },
  });
  if (!row) throw new BillingError("Document record not found on this job", 404);
}

async function assertChangeOrders(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  changeOrderIds: string[]
) {
  if (!changeOrderIds.length) return;
  const rows = await prisma.jobChangeOrder.findMany({
    where: { workspaceId, jobId, id: { in: changeOrderIds } },
    select: { id: true },
  });
  if (rows.length !== new Set(changeOrderIds).size) {
    throw new BillingError("Change Order not found on this job", 404);
  }
}

function validatePeriod(start: Date | null, end: Date | null) {
  if (start && end && start.getTime() > end.getTime()) {
    throw new BillingError("Billing period start must be on or before end", 400);
  }
}

const invoiceInclude = {
  billToCustomer: { select: { id: true, name: true } },
  documentRecord: {
    select: { id: true, documentType: true, documentNumber: true, title: true },
  },
  changeOrderAllocations: {
    include: {
      changeOrder: {
        select: { id: true, number: true, title: true, status: true, sellAmount: true },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.JobInvoiceInclude;

export type InvoiceDto = ReturnType<typeof presentInvoice>;

export function presentInvoice(row: {
  id: string;
  jobId: string;
  invoiceNumber: string;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  invoiceDate: Date;
  dueDate: Date | null;
  status: JobInvoiceStatus;
  amount: { toString(): string } | null;
  billToCustomerId: string | null;
  documentRecordId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  billToCustomer?: { id: string; name: string } | null;
  documentRecord?: {
    id: string;
    documentType: string;
    documentNumber: string | null;
    title: string | null;
  } | null;
  changeOrderAllocations?: Array<{
    id: string;
    changeOrderId: string;
    amount: { toString(): string } | null;
    notes: string | null;
    changeOrder: {
      id: string;
      number: string;
      title: string | null;
      status: string;
      sellAmount: { toString(): string } | null;
    };
  }>;
}) {
  return {
    id: row.id,
    jobId: row.jobId,
    invoiceNumber: row.invoiceNumber,
    billingPeriodStart: toUtcDateOnly(row.billingPeriodStart),
    billingPeriodEnd: toUtcDateOnly(row.billingPeriodEnd),
    invoiceDate: toUtcDateOnly(row.invoiceDate)!,
    dueDate: toUtcDateOnly(row.dueDate),
    status: row.status,
    amount: moneyToString(row.amount),
    billToCustomerId: row.billToCustomerId,
    billToCustomerName: row.billToCustomer?.name ?? null,
    documentRecordId: row.documentRecordId,
    documentRecord: row.documentRecord
      ? {
          id: row.documentRecord.id,
          documentType: row.documentRecord.documentType,
          documentNumber: row.documentRecord.documentNumber,
          title: row.documentRecord.title,
        }
      : null,
    notes: row.notes,
    changeOrderAllocations: (row.changeOrderAllocations ?? []).map((a) => ({
      id: a.id,
      changeOrderId: a.changeOrderId,
      amount: moneyToString(a.amount),
      notes: a.notes,
      changeOrderNumber: a.changeOrder.number,
      changeOrderTitle: a.changeOrder.title,
      changeOrderStatus: a.changeOrder.status,
      changeOrderSellAmount: moneyToString(a.changeOrder.sellAmount),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type BillingSnapshot = {
  invoiceCount: number;
  draftInvoiceCount: number;
  draftInvoiceValue: string | null;
  submittedInvoiceValue: string | null;
  approvedInvoiceValue: string | null;
  totalBilled: string | null;
  totalBilledInvoiceCount: number;
  revisedContractValue: string | null;
  revisedContractValueComplete: boolean;
  remainingToBill: string | null;
  remainingToBillComplete: boolean;
  billingPercentOfRevisedContract: string | null;
  billingExceedsKnownContract: boolean;
  changeOrderBilled: Array<{
    changeOrderId: string;
    number: string;
    approvedSellAmount: string | null;
    billedToDate: string | null;
    remainingUnbilled: string | null;
    remainingComplete: boolean;
  }>;
};

export type BillingSnapshotInvoiceRow = {
  status: JobInvoiceStatus;
  amount: { toString(): string } | null;
  changeOrderAllocations?: Array<{
    changeOrderId: string;
    amount: { toString(): string } | null;
  }>;
};

/**
 * Pure billing snapshot. Total billed = SUBMITTED + APPROVED known amounts.
 * DRAFT / REJECTED / VOID excluded. Reuses Phase H revised-contract inputs.
 */
export function computeBillingSnapshot(input: {
  invoices: BillingSnapshotInvoiceRow[];
  financial: Pick<JobFinancialSnapshot, "revisedContractValue" | "revisedContractValueComplete">;
  approvedChangeOrders?: Array<{
    id: string;
    number: string;
    sellAmount: { toString(): string } | null;
  }>;
}): BillingSnapshot {
  let draftSum: Prisma.Decimal | null = null;
  let draftKnown = 0;
  let draftCount = 0;
  let submittedSum: Prisma.Decimal | null = null;
  let submittedKnown = 0;
  let approvedSum: Prisma.Decimal | null = null;
  let approvedKnown = 0;
  let billedSum: Prisma.Decimal | null = null;
  let billedKnown = 0;
  let totalBilledInvoiceCount = 0;

  const coBilled = new Map<string, Prisma.Decimal>();

  for (const inv of input.invoices) {
    if (inv.status === "VOID") continue;
    const amt = inv.amount == null ? null : new PrismaNS.Decimal(inv.amount.toString());

    if (inv.status === "DRAFT") {
      draftCount += 1;
      if (amt != null) {
        draftKnown += 1;
        draftSum = draftSum == null ? amt : draftSum.add(amt);
      }
    } else if (inv.status === "SUBMITTED") {
      totalBilledInvoiceCount += 1;
      if (amt != null) {
        submittedKnown += 1;
        billedKnown += 1;
        submittedSum = submittedSum == null ? amt : submittedSum.add(amt);
        billedSum = billedSum == null ? amt : billedSum.add(amt);
      }
    } else if (inv.status === "APPROVED") {
      totalBilledInvoiceCount += 1;
      if (amt != null) {
        approvedKnown += 1;
        billedKnown += 1;
        approvedSum = approvedSum == null ? amt : approvedSum.add(amt);
        billedSum = billedSum == null ? amt : billedSum.add(amt);
      }
    }

    if (BILLED_STATUSES.has(inv.status)) {
      for (const alloc of inv.changeOrderAllocations ?? []) {
        if (alloc.amount == null) continue;
        const a = new PrismaNS.Decimal(alloc.amount.toString());
        const prev = coBilled.get(alloc.changeOrderId);
        coBilled.set(alloc.changeOrderId, prev == null ? a : prev.add(a));
      }
    }
  }

  const totalBilled =
    billedKnown === 0 && totalBilledInvoiceCount === 0
      ? "0.00"
      : billedKnown === 0
        ? null
        : moneyToString(billedSum);

  const revised = input.financial.revisedContractValue;
  const revisedComplete = input.financial.revisedContractValueComplete;
  let remainingToBill: string | null = null;
  let remainingToBillComplete = false;
  let billingPercent: string | null = null;
  let billingExceedsKnownContract = false;

  if (revised != null && totalBilled != null) {
    const rem = new PrismaNS.Decimal(revised).sub(new PrismaNS.Decimal(totalBilled));
    remainingToBill = moneyToString(rem);
    remainingToBillComplete = revisedComplete;
    billingExceedsKnownContract = rem.lessThan(0);
    const rev = new PrismaNS.Decimal(revised);
    if (!rev.isZero()) {
      billingPercent = new PrismaNS.Decimal(totalBilled).div(rev).mul(100).toFixed(2);
    } else {
      billingPercent = null;
    }
  } else if (revised == null) {
    remainingToBill = null;
    remainingToBillComplete = false;
  }

  const changeOrderBilled = (input.approvedChangeOrders ?? []).map((co) => {
    const approved = financialMoneyToString(co.sellAmount);
    const billed = coBilled.has(co.id) ? moneyToString(coBilled.get(co.id)!) : "0.00";
    let remainingUnbilled: string | null = null;
    let remainingComplete = false;
    if (approved != null && billed != null) {
      remainingUnbilled = moneyToString(new PrismaNS.Decimal(approved).sub(new PrismaNS.Decimal(billed)));
      remainingComplete = true;
    } else if (approved == null) {
      remainingUnbilled = null;
      remainingComplete = false;
    }
    return {
      changeOrderId: co.id,
      number: co.number,
      approvedSellAmount: approved,
      billedToDate: billed,
      remainingUnbilled,
      remainingComplete,
    };
  });

  return {
    invoiceCount: input.invoices.filter((i) => i.status !== "VOID").length,
    draftInvoiceCount: draftCount,
    draftInvoiceValue: draftKnown === 0 ? (draftCount === 0 ? "0.00" : null) : moneyToString(draftSum),
    submittedInvoiceValue: submittedKnown === 0 ? "0.00" : moneyToString(submittedSum),
    approvedInvoiceValue: approvedKnown === 0 ? "0.00" : moneyToString(approvedSum),
    totalBilled,
    totalBilledInvoiceCount,
    revisedContractValue: revised,
    revisedContractValueComplete: revisedComplete,
    remainingToBill,
    remainingToBillComplete,
    billingPercentOfRevisedContract: remainingToBillComplete ? billingPercent : null,
    billingExceedsKnownContract,
    changeOrderBilled,
  };
}

export async function buildBillingSnapshot(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    /** Pass a preloaded Phase H snapshot to avoid a second financial query. */
    financial?: Pick<JobFinancialSnapshot, "revisedContractValue" | "revisedContractValueComplete"> | null;
  }
): Promise<BillingSnapshot | null> {
  const financial =
    input.financial ??
    (await buildJobFinancialSnapshot(prisma, {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    }));
  if (!financial) return null;

  const [invoices, approvedCos] = await Promise.all([
    prisma.jobInvoice.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId },
      select: {
        status: true,
        amount: true,
        changeOrderAllocations: { select: { changeOrderId: true, amount: true } },
      },
    }),
    prisma.jobChangeOrder.findMany({
      where: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        status: "APPROVED",
      },
      select: { id: true, number: true, sellAmount: true },
      orderBy: { number: "asc" },
    }),
  ]);

  return computeBillingSnapshot({
    invoices,
    financial: {
      revisedContractValue: financial.revisedContractValue,
      revisedContractValueComplete: financial.revisedContractValueComplete,
    },
    approvedChangeOrders: approvedCos,
  });
}

export async function listInvoices(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string }
) {
  await assertJob(prisma, input.workspaceId, input.jobId);
  const rows = await prisma.jobInvoice.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: invoiceInclude,
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(presentInvoice);
}

export async function getInvoice(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; invoiceId: string }
) {
  const row = await prisma.jobInvoice.findFirst({
    where: { id: input.invoiceId, workspaceId: input.workspaceId, jobId: input.jobId },
    include: invoiceInclude,
  });
  if (!row) throw new BillingError("Invoice not found", 404);
  return presentInvoice(row);
}

export type CoAllocationInput = {
  changeOrderId: string;
  amount?: unknown;
  notes?: string | null | undefined;
};

async function replaceAllocations(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  allocations: CoAllocationInput[] | undefined
) {
  if (allocations === undefined) return;
  await tx.jobInvoiceChangeOrderAllocation.deleteMany({ where: { invoiceId } });
  for (const a of allocations) {
    await tx.jobInvoiceChangeOrderAllocation.create({
      data: {
        invoiceId,
        changeOrderId: a.changeOrderId,
        amount: a.amount !== undefined ? normalizeMoney(a.amount) : null,
        notes: a.notes?.trim() || null,
      },
    });
  }
}

export async function createInvoice(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    actorUserId: string;
    invoiceNumber: string;
    invoiceDate: unknown;
    billingPeriodStart?: unknown;
    billingPeriodEnd?: unknown;
    dueDate?: unknown;
    amount?: unknown;
    billToCustomerId?: string | null;
    documentRecordId?: string | null;
    notes?: string | null;
    changeOrderAllocations?: CoAllocationInput[];
  }
) {
  await assertJob(prisma, input.workspaceId, input.jobId);
  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new BillingError("Invoice number is required", 400);
  await assertInvoiceNumberAvailable(prisma, {
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    invoiceNumber,
  });

  const invoiceDate = normalizeDate(input.invoiceDate);
  if (!invoiceDate) throw new BillingError("Invoice date is required", 400);
  const periodStart =
    input.billingPeriodStart !== undefined ? normalizeDate(input.billingPeriodStart) : null;
  const periodEnd =
    input.billingPeriodEnd !== undefined ? normalizeDate(input.billingPeriodEnd) : null;
  validatePeriod(periodStart, periodEnd);
  const dueDate = input.dueDate !== undefined ? normalizeDate(input.dueDate) : null;
  const amount = input.amount !== undefined ? normalizeMoney(input.amount) : null;

  await assertBillTo(prisma, input.workspaceId, input.billToCustomerId);
  await assertDocument(prisma, input.workspaceId, input.jobId, input.documentRecordId);
  const allocIds = (input.changeOrderAllocations ?? []).map((a) => a.changeOrderId);
  await assertChangeOrders(prisma, input.workspaceId, input.jobId, allocIds);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobInvoice.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        invoiceNumber,
        invoiceDate,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        dueDate,
        amount,
        billToCustomerId: input.billToCustomerId ?? null,
        documentRecordId: input.documentRecordId ?? null,
        notes: input.notes?.trim() || null,
        status: "DRAFT",
      },
    });
    await replaceAllocations(tx, row.id, input.changeOrderAllocations);
    await tx.jobActivityLog.create({
      data: {
        jobId: input.jobId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "INVOICE_CREATED",
        newValue: activityJson({ invoiceNumber, status: "DRAFT", amount: moneyToString(amount) }),
      },
    });
    return tx.jobInvoice.findFirstOrThrow({
      where: { id: row.id },
      include: invoiceInclude,
    });
  });
  return presentInvoice(created);
}

export async function updateInvoice(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    invoiceId: string;
    actorUserId: string;
    invoiceNumber?: string;
    invoiceDate?: unknown;
    billingPeriodStart?: unknown;
    billingPeriodEnd?: unknown;
    dueDate?: unknown;
    amount?: unknown;
    billToCustomerId?: string | null;
    documentRecordId?: string | null;
    notes?: string | null;
    changeOrderAllocations?: CoAllocationInput[];
    status?: JobInvoiceStatus;
  }
) {
  const existing = await prisma.jobInvoice.findFirst({
    where: { id: input.invoiceId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!existing) throw new BillingError("Invoice not found", 404);

  let nextStatus = existing.status;
  if (input.status !== undefined && input.status !== existing.status) {
    const allowed = allowedStatusTransitions(existing.status);
    if (!allowed.includes(input.status)) {
      throw new BillingError(`Cannot transition invoice from ${existing.status} to ${input.status}`, 400);
    }
    nextStatus = input.status;
  }

  const fieldEditRequested =
    input.invoiceNumber !== undefined ||
    input.invoiceDate !== undefined ||
    input.billingPeriodStart !== undefined ||
    input.billingPeriodEnd !== undefined ||
    input.dueDate !== undefined ||
    input.amount !== undefined ||
    input.billToCustomerId !== undefined ||
    input.documentRecordId !== undefined ||
    input.notes !== undefined ||
    input.changeOrderAllocations !== undefined;

  if (fieldEditRequested && !EDITABLE_STATUSES.has(existing.status) && nextStatus === existing.status) {
    // Allow notes/document link on SUBMITTED; block amount/number/date edits.
    const blocked =
      input.invoiceNumber !== undefined ||
      input.invoiceDate !== undefined ||
      input.billingPeriodStart !== undefined ||
      input.billingPeriodEnd !== undefined ||
      input.amount !== undefined ||
      input.changeOrderAllocations !== undefined;
    if (blocked && existing.status === "SUBMITTED") {
      throw new BillingError("Reopen to Draft before editing billed amount, period, or CO allocations", 400);
    }
    if (existing.status === "APPROVED" || existing.status === "VOID") {
      throw new BillingError(`Cannot edit a ${existing.status} invoice`, 400);
    }
  }

  if (nextStatus === "SUBMITTED" || nextStatus === "APPROVED") {
    const amount =
      input.amount !== undefined ? normalizeMoney(input.amount) : existing.amount;
    if (amount == null) {
      throw new BillingError("Amount is required before submitting or approving an invoice", 400);
    }
  }

  if (input.invoiceNumber !== undefined) {
    const num = input.invoiceNumber.trim();
    if (!num) throw new BillingError("Invoice number is required", 400);
    await assertInvoiceNumberAvailable(prisma, {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      invoiceNumber: num,
      excludeId: existing.id,
    });
  }

  const periodStart =
    input.billingPeriodStart !== undefined
      ? normalizeDate(input.billingPeriodStart)
      : existing.billingPeriodStart;
  const periodEnd =
    input.billingPeriodEnd !== undefined
      ? normalizeDate(input.billingPeriodEnd)
      : existing.billingPeriodEnd;
  validatePeriod(periodStart, periodEnd);

  if (input.billToCustomerId !== undefined) {
    await assertBillTo(prisma, input.workspaceId, input.billToCustomerId);
  }
  if (input.documentRecordId !== undefined) {
    await assertDocument(prisma, input.workspaceId, input.jobId, input.documentRecordId);
  }
  if (input.changeOrderAllocations !== undefined) {
    await assertChangeOrders(
      prisma,
      input.workspaceId,
      input.jobId,
      input.changeOrderAllocations.map((a) => a.changeOrderId)
    );
  }

  const data: Prisma.JobInvoiceUncheckedUpdateInput = {};
  if (input.invoiceNumber !== undefined) data.invoiceNumber = input.invoiceNumber.trim();
  if (input.invoiceDate !== undefined) {
    const d = normalizeDate(input.invoiceDate);
    if (!d) throw new BillingError("Invoice date is required", 400);
    data.invoiceDate = d;
  }
  if (input.billingPeriodStart !== undefined) data.billingPeriodStart = periodStart;
  if (input.billingPeriodEnd !== undefined) data.billingPeriodEnd = periodEnd;
  if (input.dueDate !== undefined) data.dueDate = normalizeDate(input.dueDate);
  if (input.amount !== undefined) data.amount = normalizeMoney(input.amount);
  if (input.billToCustomerId !== undefined) data.billToCustomerId = input.billToCustomerId;
  if (input.documentRecordId !== undefined) data.documentRecordId = input.documentRecordId;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (nextStatus !== existing.status) data.status = nextStatus;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.jobInvoice.update({
      where: { id: existing.id },
      data,
    });
    await replaceAllocations(tx, row.id, input.changeOrderAllocations);

    if (nextStatus !== existing.status) {
      await tx.jobActivityLog.create({
        data: {
          jobId: input.jobId,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: activityForTransition(existing.status, nextStatus),
          previousValue: activityJson({ status: existing.status, invoiceNumber: existing.invoiceNumber }),
          newValue: activityJson({ status: nextStatus, invoiceNumber: row.invoiceNumber }),
        },
      });
    } else if (fieldEditRequested) {
      await tx.jobActivityLog.create({
        data: {
          jobId: input.jobId,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: "INVOICE_UPDATED",
          newValue: activityJson({
            invoiceNumber: row.invoiceNumber,
            amount: moneyToString(row.amount),
          }),
        },
      });
    }

    return tx.jobInvoice.findFirstOrThrow({
      where: { id: row.id },
      include: invoiceInclude,
    });
  });
  return presentInvoice(updated);
}

export async function deleteInvoice(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; invoiceId: string; actorUserId: string }
) {
  const existing = await prisma.jobInvoice.findFirst({
    where: { id: input.invoiceId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!existing) throw new BillingError("Invoice not found", 404);
  if (existing.status !== "DRAFT") {
    throw new BillingError("Only draft invoices can be deleted; void or reject instead", 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.jobInvoice.delete({ where: { id: existing.id } });
    await tx.jobActivityLog.create({
      data: {
        jobId: input.jobId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "INVOICE_DELETED",
        previousValue: activityJson({
          invoiceNumber: existing.invoiceNumber,
          status: existing.status,
        }),
      },
    });
  });
}

/** Compact deliveries with actualDeliveryDate inside [start, end] inclusive. */
export async function listPeriodDeliveries(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    periodStart: string;
    periodEnd: string;
  }
) {
  await assertJob(prisma, input.workspaceId, input.jobId);
  const start = normalizeDate(input.periodStart);
  const end = normalizeDate(input.periodEnd);
  if (!start || !end) throw new BillingError("Billing period start and end are required", 400);
  validatePeriod(start, end);

  const rows = await prisma.jobShipment.findMany({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      status: { not: "CANCELLED" },
      actualDeliveryDate: { gte: start, lte: end },
    },
    select: {
      id: true,
      deliveryNumber: true,
      actualDeliveryDate: true,
      status: true,
      items: {
        select: {
          workPackage: { select: { name: true } },
          fabricationItem: { select: { name: true } },
        },
      },
    },
    orderBy: { actualDeliveryDate: "asc" },
  });

  return rows.map((r) => {
    const packageNames = [
      ...new Set(r.items.map((i) => i.workPackage?.name).filter(Boolean) as string[]),
    ];
    const itemNames = r.items
      .map((i) => i.fabricationItem?.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 4);
    return {
      id: r.id,
      deliveryNumber: r.deliveryNumber,
      actualDeliveryDate: toUtcDateOnly(r.actualDeliveryDate),
      status: r.status,
      packageNames,
      itemSummary: itemNames.join(", ") + (r.items.length > 4 ? "…" : ""),
    };
  });
}

/** Compact installation events inside billing period. */
export async function listPeriodInstallations(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    periodStart: string;
    periodEnd: string;
  }
) {
  await assertJob(prisma, input.workspaceId, input.jobId);
  const start = normalizeDate(input.periodStart);
  const end = normalizeDate(input.periodEnd);
  if (!start || !end) throw new BillingError("Billing period start and end are required", 400);
  validatePeriod(start, end);

  const rows = await prisma.jobInstallationRecord.findMany({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      eventDate: { gte: start, lte: end },
    },
    select: {
      id: true,
      eventType: true,
      eventDate: true,
      workPackage: { select: { name: true } },
      notes: true,
    },
    orderBy: { eventDate: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    eventType: r.eventType,
    eventDate: toUtcDateOnly(r.eventDate),
    workPackageName: r.workPackage?.name ?? null,
    notes: r.notes,
  }));
}
