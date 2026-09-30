import type {
  JobProcurementCategory,
  JobProcurementItemStatus,
  JobPurchaseOrderStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { safeDateOrNull } from "@forgeops/shared";

export class ProcurementError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "ProcurementError";
  }
}

export const PROCUREMENT_CATEGORIES = [
  "MATERIAL",
  "JOIST_DECK",
  "HARDWARE",
  "COATING",
  "OUTSOURCED_FABRICATION",
  "DETAILING",
  "ENGINEERING",
  "TESTING",
  "OTHER",
] as const satisfies readonly JobProcurementCategory[];

export const PROCUREMENT_ITEM_STATUSES = [
  "NEEDED",
  "PRICING",
  "READY_TO_ORDER",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const satisfies readonly JobProcurementItemStatus[];

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const satisfies readonly JobPurchaseOrderStatus[];

/** Categories where RECEIVED means completed service, not physical delivery. */
export const SERVICE_PROCUREMENT_CATEGORIES = new Set<JobProcurementCategory>([
  "OUTSOURCED_FABRICATION",
  "DETAILING",
  "ENGINEERING",
  "TESTING",
]);

const OPEN_TO_ORDER = new Set<JobProcurementItemStatus>(["NEEDED", "PRICING", "READY_TO_ORDER"]);
const OPEN_RECEIVING = new Set<JobProcurementItemStatus>(["ORDERED", "PARTIALLY_RECEIVED"]);

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
  if (!parsed) throw new ProcurementError("Invalid date", 400);
  const ymd = toUtcDateOnly(parsed);
  if (!ymd) throw new ProcurementError("Invalid date", 400);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function utcTodayYmd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function normalizeMoney(raw: unknown): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new ProcurementError("Invalid money amount", 400);
  return new PrismaNS.Decimal(n.toFixed(2));
}

export function moneyToString(value: { toString(): string } | null | undefined): string | null {
  if (value == null) return null;
  return new PrismaNS.Decimal(value.toString()).toFixed(2);
}

export function normalizeQty(raw: unknown): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new ProcurementError("Invalid quantity", 400);
  return new PrismaNS.Decimal(n);
}

export function qtyToString(value: { toString(): string } | null | undefined): string | null {
  if (value == null) return null;
  return value.toString();
}

export type ProcurementRisk = {
  overdueToOrder: boolean;
  lateExpected: boolean;
  pastExpected: boolean;
  atRisk: boolean;
};

export function deriveProcurementRisk(
  input: {
    status: JobProcurementItemStatus;
    requiredDate?: Date | string | null;
    expectedDate?: Date | string | null;
  },
  now = new Date()
): ProcurementRisk {
  const today = utcTodayYmd(now);
  const required = toUtcDateOnly(input.requiredDate);
  const expected = toUtcDateOnly(input.expectedDate);
  const terminal = input.status === "RECEIVED" || input.status === "CANCELLED";

  const overdueToOrder =
    !terminal && OPEN_TO_ORDER.has(input.status) && required != null && required <= today;

  const lateExpected =
    !terminal &&
    required != null &&
    expected != null &&
    expected > required &&
    input.status !== "CANCELLED";

  const pastExpected =
    !terminal &&
    OPEN_RECEIVING.has(input.status) &&
    expected != null &&
    expected < today;

  return {
    overdueToOrder,
    lateExpected,
    pastExpected,
    atRisk: overdueToOrder || lateExpected || pastExpected,
  };
}

async function assertJob(prisma: PrismaClient, workspaceId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, workspaceId },
    select: { id: true },
  });
  if (!job) throw new ProcurementError("Job not found", 404);
}

async function assertPackage(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  workPackageId: string | null | undefined
) {
  if (!workPackageId) return;
  const row = await prisma.jobWorkPackage.findFirst({
    where: { id: workPackageId, workspaceId, jobId },
    select: { id: true },
  });
  if (!row) throw new ProcurementError("Work package not found on this job", 404);
}

async function assertVendor(prisma: PrismaClient, workspaceId: string, vendorId: string | null | undefined) {
  if (!vendorId) return;
  const row = await prisma.vendor.findFirst({
    where: { id: vendorId, workspaceId },
    select: { id: true },
  });
  if (!row) throw new ProcurementError("Vendor not found in this workspace", 404);
}

async function assertChange(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  changeId: string | null | undefined
) {
  if (!changeId) return;
  const row = await prisma.jobChange.findFirst({
    where: { id: changeId, workspaceId, jobId },
    select: { id: true },
  });
  if (!row) throw new ProcurementError("Source change not found on this job", 404);
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
  if (!row) throw new ProcurementError("Document record not found on this job", 404);
}

const itemInclude = {
  workPackage: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  sourceChange: { select: { id: true, number: true, title: true } },
  receipts: {
    orderBy: { receivedDate: "asc" as const },
    select: {
      id: true,
      receivedDate: true,
      quantityReceived: true,
      marksComplete: true,
      notes: true,
      createdAt: true,
    },
  },
} as const;

function sumReceivedQty(receipts: Array<{ quantityReceived: { toString(): string } | null }>): Prisma.Decimal | null {
  let sum: Prisma.Decimal | null = null;
  for (const r of receipts) {
    if (r.quantityReceived == null) continue;
    sum = sum == null ? new PrismaNS.Decimal(r.quantityReceived.toString()) : sum.add(new PrismaNS.Decimal(r.quantityReceived.toString()));
  }
  return sum;
}

export function presentProcurementItem(row: any, now = new Date()) {
  const risk = deriveProcurementRisk(row, now);
  const isService = SERVICE_PROCUREMENT_CATEGORIES.has(row.category);
  const qtyReceived = sumReceivedQty(row.receipts ?? []);
  return {
    id: row.id,
    jobId: row.jobId,
    workPackage: row.workPackage,
    category: row.category,
    isService,
    description: row.description,
    quantity: qtyToString(row.quantity),
    unit: row.unit,
    status: row.status,
    vendor: row.vendor,
    requiredDate: toUtcDateOnly(row.requiredDate),
    expectedDate: toUtcDateOnly(row.expectedDate),
    receivedDate: toUtcDateOnly(row.receivedDate),
    estimatedCost: moneyToString(row.estimatedCost),
    actualCost: moneyToString(row.actualCost),
    purchaseOrder: row.purchaseOrder,
    sourceChange: row.sourceChange,
    quantityReceivedTotal: qtyToString(qtyReceived),
    receipts: (row.receipts ?? []).map((r: any) => ({
      id: r.id,
      receivedDate: toUtcDateOnly(r.receivedDate),
      quantityReceived: qtyToString(r.quantityReceived),
      marksComplete: r.marksComplete,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    })),
    risk,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProcurementItems(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; now?: Date }
) {
  const rows = await prisma.jobProcurementItem.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: itemInclude,
    orderBy: [{ requiredDate: "asc" }, { createdAt: "desc" }],
  });
  const now = input.now ?? new Date();
  return rows.map((r) => presentProcurementItem(r, now));
}

export async function createProcurementItem(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    description: string;
    category?: JobProcurementCategory;
    workPackageId?: string | null;
    quantity?: unknown;
    unit?: string | null;
    status?: JobProcurementItemStatus;
    vendorId?: string | null;
    requiredDate?: string | null;
    expectedDate?: string | null;
    estimatedCost?: unknown;
    actualCost?: unknown;
    sourceChangeId?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
) {
  await assertJob(prisma, input.workspaceId, input.jobId);
  await assertPackage(prisma, input.workspaceId, input.jobId, input.workPackageId);
  await assertVendor(prisma, input.workspaceId, input.vendorId);
  await assertChange(prisma, input.workspaceId, input.jobId, input.sourceChangeId);
  const description = input.description.trim();
  if (!description) throw new ProcurementError("Description is required", 400);
  const unit = input.unit?.trim() || null;
  if (unit && unit.length > 20) throw new ProcurementError("Unit is too long", 400);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobProcurementItem.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        description,
        category: input.category ?? "MATERIAL",
        workPackageId: input.workPackageId ?? null,
        quantity: input.quantity !== undefined ? normalizeQty(input.quantity) : null,
        unit,
        status: input.status ?? "NEEDED",
        vendorId: input.vendorId ?? null,
        requiredDate: input.requiredDate !== undefined ? normalizeDate(input.requiredDate) : null,
        expectedDate: input.expectedDate !== undefined ? normalizeDate(input.expectedDate) : null,
        estimatedCost: input.estimatedCost !== undefined ? normalizeMoney(input.estimatedCost) : null,
        actualCost: input.actualCost !== undefined ? normalizeMoney(input.actualCost) : null,
        sourceChangeId: input.sourceChangeId ?? null,
        notes: input.notes?.trim() || null,
      },
      include: itemInclude,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "PROCUREMENT_ITEM_CREATED",
        entityType: "JOB_PROCUREMENT_ITEM",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { description: row.description, status: row.status, category: row.category },
      },
    });
    return row;
  });
  return presentProcurementItem(created);
}

export async function updateProcurementItem(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    itemId: string;
    description?: string;
    category?: JobProcurementCategory;
    workPackageId?: string | null;
    quantity?: unknown;
    unit?: string | null;
    status?: JobProcurementItemStatus;
    vendorId?: string | null;
    requiredDate?: string | null;
    expectedDate?: string | null;
    receivedDate?: string | null;
    estimatedCost?: unknown;
    actualCost?: unknown;
    purchaseOrderId?: string | null;
    sourceChangeId?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
) {
  const existing = await prisma.jobProcurementItem.findFirst({
    where: { id: input.itemId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!existing) throw new ProcurementError("Procurement item not found", 404);

  if (input.workPackageId !== undefined) {
    await assertPackage(prisma, input.workspaceId, input.jobId, input.workPackageId);
  }
  if (input.vendorId !== undefined) await assertVendor(prisma, input.workspaceId, input.vendorId);
  if (input.sourceChangeId !== undefined) {
    await assertChange(prisma, input.workspaceId, input.jobId, input.sourceChangeId);
  }
  if (input.purchaseOrderId) {
    const po = await prisma.jobPurchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, workspaceId: input.workspaceId, jobId: input.jobId },
      select: { id: true, vendorId: true, status: true },
    });
    if (!po) throw new ProcurementError("Purchase order not found on this job", 404);
    const nextVendor = input.vendorId !== undefined ? input.vendorId : existing.vendorId;
    if (po.vendorId && nextVendor && po.vendorId !== nextVendor) {
      throw new ProcurementError("Item vendor conflicts with purchase order vendor", 409);
    }
  }
  if (input.unit !== undefined && input.unit && input.unit.trim().length > 20) {
    throw new ProcurementError("Unit is too long", 400);
  }

  const nextStatus = input.status ?? existing.status;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.jobProcurementItem.update({
      where: { id: input.itemId },
      data: {
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.workPackageId !== undefined ? { workPackageId: input.workPackageId } : {}),
        ...(input.quantity !== undefined ? { quantity: normalizeQty(input.quantity) } : {}),
        ...(input.unit !== undefined ? { unit: input.unit?.trim() || null } : {}),
        status: nextStatus,
        ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
        ...(input.requiredDate !== undefined ? { requiredDate: normalizeDate(input.requiredDate) } : {}),
        ...(input.expectedDate !== undefined ? { expectedDate: normalizeDate(input.expectedDate) } : {}),
        ...(input.receivedDate !== undefined ? { receivedDate: normalizeDate(input.receivedDate) } : {}),
        ...(input.estimatedCost !== undefined ? { estimatedCost: normalizeMoney(input.estimatedCost) } : {}),
        ...(input.actualCost !== undefined ? { actualCost: normalizeMoney(input.actualCost) } : {}),
        ...(input.purchaseOrderId !== undefined ? { purchaseOrderId: input.purchaseOrderId } : {}),
        ...(input.sourceChangeId !== undefined ? { sourceChangeId: input.sourceChangeId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: itemInclude,
    });
    const action =
      nextStatus === "CANCELLED" && existing.status !== "CANCELLED"
        ? "PROCUREMENT_ITEM_CANCELLED"
        : nextStatus === "RECEIVED" && existing.status !== "RECEIVED"
          ? "PROCUREMENT_ITEM_COMPLETED"
          : "PROCUREMENT_ITEM_UPDATED";
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action,
        entityType: "JOB_PROCUREMENT_ITEM",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: { status: existing.status },
        newValue: { status: row.status },
      },
    });
    return row;
  });
  return presentProcurementItem(updated);
}

export async function deleteProcurementItem(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; itemId: string; actorUserId: string }
) {
  const existing = await prisma.jobProcurementItem.findFirst({
    where: { id: input.itemId, workspaceId: input.workspaceId, jobId: input.jobId },
    include: { receipts: { select: { id: true } } },
  });
  if (!existing) throw new ProcurementError("Procurement item not found", 404);
  if (existing.purchaseOrderId || existing.receipts.length > 0) {
    throw new ProcurementError("Cancel the item instead — it is ordered or has receipts", 409);
  }
  if (!OPEN_TO_ORDER.has(existing.status) && existing.status !== "CANCELLED") {
    throw new ProcurementError("Only needed/pricing/ready or cancelled items can be deleted", 409);
  }
  await prisma.jobProcurementItem.delete({ where: { id: existing.id } });
}

export async function recordProcurementReceipt(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    itemId: string;
    receivedDate?: string | null;
    quantityReceived?: unknown;
    marksComplete?: boolean;
    notes?: string | null;
    actorUserId: string;
  }
) {
  const existing = await prisma.jobProcurementItem.findFirst({
    where: { id: input.itemId, workspaceId: input.workspaceId, jobId: input.jobId },
    include: itemInclude,
  });
  if (!existing) throw new ProcurementError("Procurement item not found", 404);
  if (existing.status === "CANCELLED") {
    throw new ProcurementError("Cannot receive a cancelled item", 409);
  }
  if (existing.status === "NEEDED" || existing.status === "PRICING" || existing.status === "READY_TO_ORDER") {
    throw new ProcurementError("Item must be ordered before receiving", 409);
  }

  const receivedDate = normalizeDate(input.receivedDate ?? utcTodayYmd())!;
  const qty = input.quantityReceived !== undefined ? normalizeQty(input.quantityReceived) : null;
  const marksComplete = input.marksComplete === true;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.jobProcurementReceipt.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        procurementItemId: input.itemId,
        receivedDate,
        quantityReceived: qty,
        marksComplete,
        notes: input.notes?.trim() || null,
      },
    });

    const receipts = await tx.jobProcurementReceipt.findMany({
      where: { procurementItemId: input.itemId },
      select: { quantityReceived: true, marksComplete: true, receivedDate: true },
    });
    const anyComplete = marksComplete || receipts.some((r) => r.marksComplete);
    const qtySum = sumReceivedQty(receipts);
    let nextStatus: JobProcurementItemStatus = existing.status;
    let nextReceivedDate = existing.receivedDate;

    if (anyComplete) {
      nextStatus = "RECEIVED";
      nextReceivedDate = receivedDate;
    } else if (
      existing.quantity != null &&
      qtySum != null &&
      qtySum.gte(new PrismaNS.Decimal(existing.quantity.toString()))
    ) {
      nextStatus = "RECEIVED";
      nextReceivedDate = receivedDate;
    } else {
      nextStatus = "PARTIALLY_RECEIVED";
    }

    const row = await tx.jobProcurementItem.update({
      where: { id: input.itemId },
      data: { status: nextStatus, receivedDate: nextReceivedDate },
      include: itemInclude,
    });

    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: nextStatus === "RECEIVED" ? "PROCUREMENT_ITEM_COMPLETED" : "PROCUREMENT_RECEIPT_RECORDED",
        entityType: "JOB_PROCUREMENT_ITEM",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: {
          status: nextStatus,
          receivedDate: toUtcDateOnly(receivedDate),
          quantityReceived: qtyToString(qty),
        },
      },
    });

    // Soft-sync PO status from its items (receipt progress only).
    if (row.purchaseOrderId) {
      await syncPurchaseOrderStatus(tx as unknown as PrismaClient, row.purchaseOrderId);
    }
    return row;
  });

  return presentProcurementItem(updated);
}

async function syncPurchaseOrderStatus(prisma: PrismaClient, purchaseOrderId: string) {
  const po = await prisma.jobPurchaseOrder.findFirst({
    where: { id: purchaseOrderId },
    include: { items: { select: { status: true } } },
  });
  if (!po || po.status === "DRAFT" || po.status === "CANCELLED") return;
  const active = po.items.filter((i) => i.status !== "CANCELLED");
  if (!active.length) return;
  const allReceived = active.every((i) => i.status === "RECEIVED");
  const anyReceived = active.some(
    (i) => i.status === "RECEIVED" || i.status === "PARTIALLY_RECEIVED"
  );
  let next: JobPurchaseOrderStatus = po.status;
  if (allReceived) next = "RECEIVED";
  else if (anyReceived) next = "PARTIALLY_RECEIVED";
  if (next !== po.status) {
    await prisma.jobPurchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: next },
    });
  }
}

const poInclude = {
  vendor: { select: { id: true, name: true } },
  documentRecord: {
    select: { id: true, documentNumber: true, title: true, documentType: true },
  },
  items: {
    include: {
      workPackage: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

export function presentPurchaseOrder(row: any) {
  return {
    id: row.id,
    jobId: row.jobId,
    poNumber: row.poNumber,
    vendor: row.vendor,
    status: row.status,
    orderedDate: toUtcDateOnly(row.orderedDate),
    expectedDate: toUtcDateOnly(row.expectedDate),
    amount: moneyToString(row.amount),
    documentRecord: row.documentRecord,
    notes: row.notes,
    items: (row.items ?? []).map((i: any) => ({
      id: i.id,
      description: i.description,
      status: i.status,
      category: i.category,
      quantity: qtyToString(i.quantity),
      unit: i.unit,
      workPackage: i.workPackage,
      estimatedCost: moneyToString(i.estimatedCost),
      actualCost: moneyToString(i.actualCost),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPurchaseOrders(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string }
) {
  const rows = await prisma.jobPurchaseOrder.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: poInclude,
    orderBy: [{ orderedDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(presentPurchaseOrder);
}

export async function createPurchaseOrder(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    poNumber: string;
    vendorId?: string | null;
    status?: JobPurchaseOrderStatus;
    orderedDate?: string | null;
    expectedDate?: string | null;
    amount?: unknown;
    documentRecordId?: string | null;
    itemIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  await assertJob(prisma, input.workspaceId, input.jobId);
  await assertVendor(prisma, input.workspaceId, input.vendorId);
  await assertDocument(prisma, input.workspaceId, input.jobId, input.documentRecordId);
  const poNumber = input.poNumber.trim();
  if (!poNumber) throw new ProcurementError("PO number is required", 400);

  const clash = await prisma.jobPurchaseOrder.findFirst({
    where: {
      jobId: input.jobId,
      poNumber: { equals: poNumber, mode: "insensitive" },
      status: { not: "CANCELLED" },
    },
    select: { id: true },
  });
  if (clash) throw new ProcurementError("An active PO with this number already exists on this job", 409);

  const itemIds = input.itemIds ?? [];
  let items: Array<{ id: string; vendorId: string | null; purchaseOrderId: string | null; status: JobProcurementItemStatus }> =
    [];
  if (itemIds.length) {
    items = await prisma.jobProcurementItem.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId, id: { in: itemIds } },
      select: { id: true, vendorId: true, purchaseOrderId: true, status: true },
    });
    if (items.length !== itemIds.length) {
      throw new ProcurementError("Procurement item not found on this job", 404);
    }
    if (items.some((i) => i.purchaseOrderId)) {
      throw new ProcurementError("One or more items already belong to a purchase order", 409);
    }
    if (items.some((i) => i.status === "CANCELLED" || i.status === "RECEIVED")) {
      throw new ProcurementError("Cannot add cancelled or received items to a new PO", 409);
    }
    if (input.vendorId) {
      const conflict = items.find((i) => i.vendorId && i.vendorId !== input.vendorId);
      if (conflict) {
        throw new ProcurementError("Item vendor conflicts with purchase order vendor", 409);
      }
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobPurchaseOrder.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        poNumber,
        vendorId: input.vendorId ?? null,
        status: input.status ?? "DRAFT",
        orderedDate:
          input.orderedDate !== undefined
            ? normalizeDate(input.orderedDate)
            : input.status === "ISSUED"
              ? normalizeDate(utcTodayYmd())
              : null,
        expectedDate: input.expectedDate !== undefined ? normalizeDate(input.expectedDate) : null,
        amount: input.amount !== undefined ? normalizeMoney(input.amount) : null,
        documentRecordId: input.documentRecordId ?? null,
        notes: input.notes?.trim() || null,
      },
    });

    if (itemIds.length) {
      // Per-item: set vendor if empty; bump to ORDERED when PO is ISSUED
      for (const item of items) {
        const data: Prisma.JobProcurementItemUpdateInput = {
          purchaseOrder: { connect: { id: row.id } },
        };
        if (input.vendorId && !item.vendorId) {
          data.vendor = { connect: { id: input.vendorId } };
        }
        if ((input.status ?? "DRAFT") === "ISSUED" && OPEN_TO_ORDER.has(item.status)) {
          data.status = "ORDERED";
        }
        await tx.jobProcurementItem.update({ where: { id: item.id }, data });
      }
    }

    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action:
          (input.status ?? "DRAFT") === "ISSUED" ? "PURCHASE_ORDER_ISSUED" : "PURCHASE_ORDER_CREATED",
        entityType: "JOB_PURCHASE_ORDER",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { poNumber: row.poNumber, status: row.status, itemCount: itemIds.length },
      },
    });

    return tx.jobPurchaseOrder.findFirstOrThrow({
      where: { id: row.id },
      include: poInclude,
    });
  });

  return presentPurchaseOrder(created);
}

export async function updatePurchaseOrder(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    purchaseOrderId: string;
    poNumber?: string;
    vendorId?: string | null;
    status?: JobPurchaseOrderStatus;
    orderedDate?: string | null;
    expectedDate?: string | null;
    amount?: unknown;
    documentRecordId?: string | null;
    itemIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const existing = await prisma.jobPurchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, workspaceId: input.workspaceId, jobId: input.jobId },
    include: { items: { select: { id: true, vendorId: true, status: true } } },
  });
  if (!existing) throw new ProcurementError("Purchase order not found", 404);

  if (input.vendorId !== undefined) await assertVendor(prisma, input.workspaceId, input.vendorId);
  if (input.documentRecordId !== undefined) {
    await assertDocument(prisma, input.workspaceId, input.jobId, input.documentRecordId);
  }
  if (input.poNumber !== undefined) {
    const poNumber = input.poNumber.trim();
    if (!poNumber) throw new ProcurementError("PO number is required", 400);
    const clash = await prisma.jobPurchaseOrder.findFirst({
      where: {
        jobId: input.jobId,
        poNumber: { equals: poNumber, mode: "insensitive" },
        status: { not: "CANCELLED" },
        id: { not: input.purchaseOrderId },
      },
      select: { id: true },
    });
    if (clash) throw new ProcurementError("An active PO with this number already exists on this job", 409);
  }

  const nextVendor = input.vendorId !== undefined ? input.vendorId : existing.vendorId;
  if (input.itemIds) {
    const items = await prisma.jobProcurementItem.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId, id: { in: input.itemIds } },
      select: { id: true, vendorId: true, purchaseOrderId: true, status: true },
    });
    if (items.length !== input.itemIds.length) {
      throw new ProcurementError("Procurement item not found on this job", 404);
    }
    if (items.some((i) => i.purchaseOrderId && i.purchaseOrderId !== input.purchaseOrderId)) {
      throw new ProcurementError("One or more items already belong to another purchase order", 409);
    }
    if (nextVendor) {
      const conflict = items.find((i) => i.vendorId && i.vendorId !== nextVendor);
      if (conflict) {
        throw new ProcurementError("Item vendor conflicts with purchase order vendor", 409);
      }
    }
  } else if (nextVendor) {
    const conflict = existing.items.find((i) => i.vendorId && i.vendorId !== nextVendor);
    if (conflict) {
      throw new ProcurementError("Item vendor conflicts with purchase order vendor", 409);
    }
  }

  const nextStatus = input.status ?? existing.status;
  let orderedDate =
    input.orderedDate !== undefined ? normalizeDate(input.orderedDate) : existing.orderedDate;
  if (input.status === "ISSUED" && existing.status !== "ISSUED" && orderedDate == null) {
    orderedDate = normalizeDate(utcTodayYmd());
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.itemIds) {
      await tx.jobProcurementItem.updateMany({
        where: { purchaseOrderId: input.purchaseOrderId, id: { notIn: input.itemIds } },
        data: { purchaseOrderId: null },
      });
      const items = await tx.jobProcurementItem.findMany({
        where: { id: { in: input.itemIds }, jobId: input.jobId },
        select: { id: true, vendorId: true, status: true },
      });
      for (const item of items) {
        const data: Prisma.JobProcurementItemUpdateInput = {
          purchaseOrder: { connect: { id: input.purchaseOrderId } },
        };
        if (nextVendor && !item.vendorId) {
          data.vendor = { connect: { id: nextVendor } };
        }
        if (nextStatus === "ISSUED" && OPEN_TO_ORDER.has(item.status)) {
          data.status = "ORDERED";
        }
        await tx.jobProcurementItem.update({ where: { id: item.id }, data });
      }
    } else if (input.status === "ISSUED" && existing.status !== "ISSUED") {
      for (const item of existing.items) {
        if (OPEN_TO_ORDER.has(item.status)) {
          await tx.jobProcurementItem.update({
            where: { id: item.id },
            data: {
              status: "ORDERED",
              ...(nextVendor && !item.vendorId ? { vendorId: nextVendor } : {}),
            },
          });
        }
      }
    }

    const row = await tx.jobPurchaseOrder.update({
      where: { id: input.purchaseOrderId },
      data: {
        ...(input.poNumber !== undefined ? { poNumber: input.poNumber.trim() } : {}),
        ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
        status: nextStatus,
        orderedDate,
        ...(input.expectedDate !== undefined ? { expectedDate: normalizeDate(input.expectedDate) } : {}),
        ...(input.amount !== undefined ? { amount: normalizeMoney(input.amount) } : {}),
        ...(input.documentRecordId !== undefined ? { documentRecordId: input.documentRecordId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: poInclude,
    });

    const action =
      nextStatus === "CANCELLED" && existing.status !== "CANCELLED"
        ? "PURCHASE_ORDER_CANCELLED"
        : nextStatus === "ISSUED" && existing.status !== "ISSUED"
          ? "PURCHASE_ORDER_ISSUED"
          : "PURCHASE_ORDER_UPDATED";
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action,
        entityType: "JOB_PURCHASE_ORDER",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: { status: existing.status, poNumber: existing.poNumber },
        newValue: { status: row.status, poNumber: row.poNumber },
      },
    });
    return row;
  });

  return presentPurchaseOrder(updated);
}

export async function deletePurchaseOrder(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; purchaseOrderId: string; actorUserId: string }
) {
  const existing = await prisma.jobPurchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, workspaceId: input.workspaceId, jobId: input.jobId },
    include: { items: { select: { id: true } } },
  });
  if (!existing) throw new ProcurementError("Purchase order not found", 404);
  if (existing.status !== "DRAFT" && existing.status !== "CANCELLED") {
    throw new ProcurementError("Only draft or cancelled POs can be deleted; cancel instead", 409);
  }
  if (existing.items.length > 0 && existing.status === "DRAFT") {
    // Unlink items then delete draft
    await prisma.$transaction(async (tx) => {
      await tx.jobProcurementItem.updateMany({
        where: { purchaseOrderId: existing.id },
        data: { purchaseOrderId: null },
      });
      await tx.jobPurchaseOrder.delete({ where: { id: existing.id } });
    });
    return;
  }
  if (existing.items.length > 0) {
    throw new ProcurementError("Unlink items before deleting a cancelled PO", 409);
  }
  await prisma.jobPurchaseOrder.delete({ where: { id: existing.id } });
}

export type ProcurementSummary = {
  needsOrderingCount: number;
  atRiskCount: number;
  pastExpectedCount: number;
  orderedAmount: string | null;
};

export async function buildProcurementSummary(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; now?: Date }
): Promise<ProcurementSummary> {
  const now = input.now ?? new Date();
  const [items, pos] = await Promise.all([
    prisma.jobProcurementItem.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId },
      select: { status: true, requiredDate: true, expectedDate: true },
    }),
    prisma.jobPurchaseOrder.findMany({
      where: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        status: { in: ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] },
      },
      select: { amount: true },
    }),
  ]);

  let needsOrderingCount = 0;
  let atRiskCount = 0;
  let pastExpectedCount = 0;
  for (const item of items) {
    if (OPEN_TO_ORDER.has(item.status)) needsOrderingCount += 1;
    const risk = deriveProcurementRisk(item, now);
    if (risk.atRisk) atRiskCount += 1;
    if (risk.pastExpected) pastExpectedCount += 1;
  }

  let orderedSum: Prisma.Decimal | null = null;
  for (const po of pos) {
    if (po.amount == null) continue;
    orderedSum = orderedSum == null ? po.amount : orderedSum.add(po.amount);
  }

  return {
    needsOrderingCount,
    atRiskCount,
    pastExpectedCount,
    orderedAmount: moneyToString(orderedSum),
  };
}

/** Package-scoped counts for Scope tab — one query, no full item hydration. */
export async function countProcurementByPackage(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; now?: Date }
): Promise<Map<string, { itemCount: number; atRiskCount: number }>> {
  const now = input.now ?? new Date();
  const rows = await prisma.jobProcurementItem.findMany({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      workPackageId: { not: null },
      status: { not: "CANCELLED" },
    },
    select: { workPackageId: true, status: true, requiredDate: true, expectedDate: true },
  });
  const map = new Map<string, { itemCount: number; atRiskCount: number }>();
  for (const row of rows) {
    const id = row.workPackageId!;
    const cur = map.get(id) ?? { itemCount: 0, atRiskCount: 0 };
    cur.itemCount += 1;
    if (deriveProcurementRisk(row, now).atRisk) cur.atRiskCount += 1;
    map.set(id, cur);
  }
  return map;
}
