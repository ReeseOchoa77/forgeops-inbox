import type {
  JobInstallationEventType,
  JobShipmentStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { safeDateOrNull } from "@forgeops/shared";

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

export const SHIPMENT_STATUSES = [
  "PLANNED",
  "READY",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
] as const satisfies readonly JobShipmentStatus[];

export const INSTALLATION_EVENT_TYPES = [
  "STARTED",
  "PROGRESS",
  "COMPLETED",
] as const satisfies readonly JobInstallationEventType[];

const ACTIVE_HISTORY = new Set<JobShipmentStatus>(["IN_TRANSIT", "DELIVERED"]);

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
  if (!parsed) throw new DeliveryError("Invalid date", 400);
  const ymd = toUtcDateOnly(parsed);
  if (!ymd) throw new DeliveryError("Invalid date", 400);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function utcTodayYmd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function normalizeQty(raw: unknown): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new DeliveryError("Invalid quantity", 400);
  return new PrismaNS.Decimal(n);
}

export function qtyToString(value: { toString(): string } | null | undefined): string | null {
  if (value == null) return null;
  return value.toString();
}

export type DeliveryRisk = {
  lateToShip: boolean;
  lateDelivery: boolean;
  atRisk: boolean;
};

export function deriveDeliveryRisk(
  input: {
    status: JobShipmentStatus;
    plannedShipDate?: Date | string | null;
    actualShipDate?: Date | string | null;
    plannedDeliveryDate?: Date | string | null;
    actualDeliveryDate?: Date | string | null;
  },
  now = new Date()
): DeliveryRisk {
  if (input.status === "CANCELLED" || input.status === "DELIVERED") {
    return { lateToShip: false, lateDelivery: false, atRisk: false };
  }
  const today = utcTodayYmd(now);
  const plannedShip = toUtcDateOnly(input.plannedShipDate);
  const plannedDel = toUtcDateOnly(input.plannedDeliveryDate);
  const lateToShip =
    input.actualShipDate == null && plannedShip != null && plannedShip < today;
  const lateDelivery =
    input.actualDeliveryDate == null && plannedDel != null && plannedDel < today;
  return { lateToShip, lateDelivery, atRisk: lateToShip || lateDelivery };
}

async function assertJob(prisma: PrismaClient, workspaceId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, workspaceId },
    select: {
      id: true,
      siteName: true,
      siteAddress1: true,
      siteAddress2: true,
      siteCity: true,
      siteState: true,
      sitePostalCode: true,
    },
  });
  if (!job) throw new DeliveryError("Job not found", 404);
  return job;
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
    select: { id: true, name: true },
  });
  if (!row) throw new DeliveryError("Work package not found on this job", 404);
  return row;
}

async function assertFabricationItem(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  fabricationItemId: string | null | undefined
) {
  if (!fabricationItemId) return null;
  const row = await prisma.jobFabricationItem.findFirst({
    where: { id: fabricationItemId, workspaceId, jobId },
    select: { id: true, name: true, quantity: true, workPackageId: true },
  });
  if (!row) throw new DeliveryError("Fabrication item not found on this job", 404);
  return row;
}

async function assertDocuments(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  documentIds: string[]
) {
  if (!documentIds.length) return;
  const rows = await prisma.jobDocumentRecord.findMany({
    where: { workspaceId, jobId, id: { in: documentIds } },
    select: { id: true },
  });
  if (rows.length !== new Set(documentIds).size) {
    throw new DeliveryError("Document record not found on this job", 404);
  }
}

async function assertParticipant(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  participantId: string | null | undefined
) {
  if (!participantId) return;
  const row = await prisma.jobParticipant.findFirst({
    where: { id: participantId, workspaceId, jobId },
    select: { id: true },
  });
  if (!row) throw new DeliveryError("Participant not found on this job", 404);
}

async function assertActiveDeliveryNumber(
  prisma: PrismaClient,
  jobId: string,
  deliveryNumber: string,
  excludeId?: string
) {
  const number = deliveryNumber.trim();
  if (!number) throw new DeliveryError("Delivery number is required", 400);
  const clash = await prisma.jobShipment.findFirst({
    where: {
      jobId,
      deliveryNumber: { equals: number, mode: "insensitive" },
      status: { not: "CANCELLED" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new DeliveryError("An active delivery with this number already exists on this job", 409);
  return number;
}

const shipmentInclude = {
  items: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      workPackage: { select: { id: true, name: true } },
      fabricationItem: { select: { id: true, name: true, quantity: true } },
    },
  },
  documents: {
    include: {
      documentRecord: {
        select: { id: true, documentNumber: true, title: true, documentType: true },
      },
    },
  },
};

export function presentShipment(row: any, now = new Date()) {
  const packages = new Map<string, { id: string; name: string }>();
  for (const item of row.items ?? []) {
    if (item.workPackage) packages.set(item.workPackage.id, item.workPackage);
  }
  return {
    id: row.id,
    jobId: row.jobId,
    deliveryNumber: row.deliveryNumber,
    status: row.status,
    plannedShipDate: toUtcDateOnly(row.plannedShipDate),
    actualShipDate: toUtcDateOnly(row.actualShipDate),
    plannedDeliveryDate: toUtcDateOnly(row.plannedDeliveryDate),
    actualDeliveryDate: toUtcDateOnly(row.actualDeliveryDate),
    destinationName: row.destinationName,
    destinationAddress1: row.destinationAddress1,
    destinationAddress2: row.destinationAddress2,
    destinationCity: row.destinationCity,
    destinationState: row.destinationState,
    destinationPostalCode: row.destinationPostalCode,
    carrierName: row.carrierName,
    driverName: row.driverName,
    truckNumber: row.truckNumber,
    notes: row.notes,
    packages: [...packages.values()],
    lineCount: (row.items ?? []).length,
    items: (row.items ?? []).map((item: any) => ({
      id: item.id,
      workPackage: item.workPackage,
      fabricationItem: item.fabricationItem
        ? {
            id: item.fabricationItem.id,
            name: item.fabricationItem.name,
            quantity: qtyToString(item.fabricationItem.quantity),
          }
        : null,
      description: item.description,
      quantity: qtyToString(item.quantity),
      unit: item.unit,
      notes: item.notes,
      sortOrder: item.sortOrder,
    })),
    documents: (row.documents ?? []).map((d: any) => ({
      id: d.documentRecord.id,
      documentNumber: d.documentRecord.documentNumber,
      title: d.documentRecord.title,
      documentType: d.documentRecord.documentType,
    })),
    risk: deriveDeliveryRisk(row, now),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listShipments(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; now?: Date }
) {
  const rows = await prisma.jobShipment.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: shipmentInclude,
    orderBy: [{ plannedDeliveryDate: "asc" }, { createdAt: "desc" }],
  });
  const now = input.now ?? new Date();
  return rows.map((r) => presentShipment(r, now));
}

export async function createShipment(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    deliveryNumber: string;
    status?: JobShipmentStatus;
    plannedShipDate?: string | null;
    plannedDeliveryDate?: string | null;
    destinationName?: string | null;
    destinationAddress1?: string | null;
    destinationAddress2?: string | null;
    destinationCity?: string | null;
    destinationState?: string | null;
    destinationPostalCode?: string | null;
    useJobSite?: boolean;
    carrierName?: string | null;
    driverName?: string | null;
    truckNumber?: string | null;
    documentRecordIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const job = await assertJob(prisma, input.workspaceId, input.jobId);
  const deliveryNumber = await assertActiveDeliveryNumber(prisma, input.jobId, input.deliveryNumber);
  await assertDocuments(prisma, input.workspaceId, input.jobId, input.documentRecordIds ?? []);

  const useSite = input.useJobSite !== false;
  const destinationName =
    input.destinationName !== undefined
      ? input.destinationName?.trim() || null
      : useSite
        ? job.siteName
        : null;
  const destinationAddress1 =
    input.destinationAddress1 !== undefined
      ? input.destinationAddress1?.trim() || null
      : useSite
        ? job.siteAddress1
        : null;
  const destinationAddress2 =
    input.destinationAddress2 !== undefined
      ? input.destinationAddress2?.trim() || null
      : useSite
        ? job.siteAddress2
        : null;
  const destinationCity =
    input.destinationCity !== undefined
      ? input.destinationCity?.trim() || null
      : useSite
        ? job.siteCity
        : null;
  const destinationState =
    input.destinationState !== undefined
      ? input.destinationState?.trim() || null
      : useSite
        ? job.siteState
        : null;
  const destinationPostalCode =
    input.destinationPostalCode !== undefined
      ? input.destinationPostalCode?.trim() || null
      : useSite
        ? job.sitePostalCode
        : null;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobShipment.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        deliveryNumber,
        status: input.status ?? "PLANNED",
        plannedShipDate:
          input.plannedShipDate !== undefined ? normalizeDate(input.plannedShipDate) : null,
        plannedDeliveryDate:
          input.plannedDeliveryDate !== undefined ? normalizeDate(input.plannedDeliveryDate) : null,
        destinationName,
        destinationAddress1,
        destinationAddress2,
        destinationCity,
        destinationState,
        destinationPostalCode,
        carrierName: input.carrierName?.trim() || null,
        driverName: input.driverName?.trim() || null,
        truckNumber: input.truckNumber?.trim() || null,
        notes: input.notes?.trim() || null,
        documents: {
          create: (input.documentRecordIds ?? []).map((documentRecordId) => ({ documentRecordId })),
        },
      },
      include: shipmentInclude,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "DELIVERY_CREATED",
        entityType: "JOB_SHIPMENT",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { deliveryNumber: row.deliveryNumber, status: row.status },
      },
    });
    return row;
  });
  return presentShipment(created);
}

export async function updateShipment(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    shipmentId: string;
    deliveryNumber?: string;
    status?: JobShipmentStatus;
    plannedShipDate?: string | null;
    actualShipDate?: string | null;
    plannedDeliveryDate?: string | null;
    actualDeliveryDate?: string | null;
    destinationName?: string | null;
    destinationAddress1?: string | null;
    destinationAddress2?: string | null;
    destinationCity?: string | null;
    destinationState?: string | null;
    destinationPostalCode?: string | null;
    carrierName?: string | null;
    driverName?: string | null;
    truckNumber?: string | null;
    documentRecordIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const existing = await prisma.jobShipment.findFirst({
    where: { id: input.shipmentId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!existing) throw new DeliveryError("Delivery not found", 404);

  if (input.deliveryNumber !== undefined) {
    await assertActiveDeliveryNumber(prisma, input.jobId, input.deliveryNumber, input.shipmentId);
  }
  if (input.documentRecordIds) {
    await assertDocuments(prisma, input.workspaceId, input.jobId, input.documentRecordIds);
  }

  let nextStatus = input.status ?? existing.status;
  let actualShipDate =
    input.actualShipDate !== undefined ? normalizeDate(input.actualShipDate) : existing.actualShipDate;
  let actualDeliveryDate =
    input.actualDeliveryDate !== undefined
      ? normalizeDate(input.actualDeliveryDate)
      : existing.actualDeliveryDate;

  // Convenience transitions — planned dates are never overwritten.
  if (input.status === "IN_TRANSIT" && existing.status !== "IN_TRANSIT" && actualShipDate == null) {
    actualShipDate = normalizeDate(utcTodayYmd());
  }
  if (input.status === "DELIVERED" && existing.status !== "DELIVERED") {
    if (actualDeliveryDate == null) actualDeliveryDate = normalizeDate(utcTodayYmd());
    if (actualShipDate == null) actualShipDate = actualDeliveryDate;
    nextStatus = "DELIVERED";
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.documentRecordIds) {
      await tx.jobShipmentDocument.deleteMany({ where: { shipmentId: input.shipmentId } });
      if (input.documentRecordIds.length) {
        await tx.jobShipmentDocument.createMany({
          data: input.documentRecordIds.map((documentRecordId) => ({
            shipmentId: input.shipmentId,
            documentRecordId,
          })),
        });
      }
    }
    const row = await tx.jobShipment.update({
      where: { id: input.shipmentId },
      data: {
        ...(input.deliveryNumber !== undefined ? { deliveryNumber: input.deliveryNumber.trim() } : {}),
        status: nextStatus,
        ...(input.plannedShipDate !== undefined
          ? { plannedShipDate: normalizeDate(input.plannedShipDate) }
          : {}),
        actualShipDate,
        ...(input.plannedDeliveryDate !== undefined
          ? { plannedDeliveryDate: normalizeDate(input.plannedDeliveryDate) }
          : {}),
        actualDeliveryDate,
        ...(input.destinationName !== undefined
          ? { destinationName: input.destinationName?.trim() || null }
          : {}),
        ...(input.destinationAddress1 !== undefined
          ? { destinationAddress1: input.destinationAddress1?.trim() || null }
          : {}),
        ...(input.destinationAddress2 !== undefined
          ? { destinationAddress2: input.destinationAddress2?.trim() || null }
          : {}),
        ...(input.destinationCity !== undefined
          ? { destinationCity: input.destinationCity?.trim() || null }
          : {}),
        ...(input.destinationState !== undefined
          ? { destinationState: input.destinationState?.trim() || null }
          : {}),
        ...(input.destinationPostalCode !== undefined
          ? { destinationPostalCode: input.destinationPostalCode?.trim() || null }
          : {}),
        ...(input.carrierName !== undefined ? { carrierName: input.carrierName?.trim() || null } : {}),
        ...(input.driverName !== undefined ? { driverName: input.driverName?.trim() || null } : {}),
        ...(input.truckNumber !== undefined ? { truckNumber: input.truckNumber?.trim() || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: shipmentInclude,
    });

    let action: "DELIVERY_UPDATED" | "DELIVERY_SHIPPED" | "DELIVERY_DELIVERED" | "DELIVERY_CANCELLED" =
      "DELIVERY_UPDATED";
    if (nextStatus === "CANCELLED" && existing.status !== "CANCELLED") action = "DELIVERY_CANCELLED";
    else if (nextStatus === "DELIVERED" && existing.status !== "DELIVERED") action = "DELIVERY_DELIVERED";
    else if (nextStatus === "IN_TRANSIT" && existing.status !== "IN_TRANSIT") action = "DELIVERY_SHIPPED";

    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action,
        entityType: "JOB_SHIPMENT",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: { status: existing.status, deliveryNumber: existing.deliveryNumber },
        newValue: { status: row.status, deliveryNumber: row.deliveryNumber },
      },
    });
    return row;
  });
  return presentShipment(updated);
}

export async function deleteShipment(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; shipmentId: string; actorUserId: string }
) {
  const existing = await prisma.jobShipment.findFirst({
    where: { id: input.shipmentId, workspaceId: input.workspaceId, jobId: input.jobId },
    include: { items: { select: { id: true } } },
  });
  if (!existing) throw new DeliveryError("Delivery not found", 404);
  if (ACTIVE_HISTORY.has(existing.status)) {
    throw new DeliveryError("Cancel instead — shipped/delivered history cannot be deleted", 409);
  }
  if (existing.status !== "PLANNED" && existing.status !== "READY" && existing.status !== "CANCELLED") {
    throw new DeliveryError("Only planned, ready, or cancelled deliveries can be deleted", 409);
  }
  await prisma.jobShipment.delete({ where: { id: existing.id } });
}

export async function addShipmentItem(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    shipmentId: string;
    workPackageId?: string | null;
    fabricationItemId?: string | null;
    description?: string | null;
    quantity?: unknown;
    unit?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
) {
  const shipment = await prisma.jobShipment.findFirst({
    where: { id: input.shipmentId, workspaceId: input.workspaceId, jobId: input.jobId },
    select: { id: true, status: true },
  });
  if (!shipment) throw new DeliveryError("Delivery not found", 404);
  if (shipment.status === "CANCELLED") throw new DeliveryError("Cannot add lines to a cancelled delivery", 409);

  const pkg = await assertPackage(prisma, input.workspaceId, input.jobId, input.workPackageId);
  const fab = await assertFabricationItem(
    prisma,
    input.workspaceId,
    input.jobId,
    input.fabricationItemId
  );

  let workPackageId = input.workPackageId ?? fab?.workPackageId ?? null;
  if (workPackageId) await assertPackage(prisma, input.workspaceId, input.jobId, workPackageId);

  const description =
    input.description?.trim() || fab?.name || pkg?.name || null;
  if (!description) throw new DeliveryError("Description is required for custom lines", 400);
  if (input.unit && input.unit.trim().length > 20) throw new DeliveryError("Unit is too long", 400);

  const qty = input.quantity !== undefined ? normalizeQty(input.quantity) : null;

  const maxSort = await prisma.jobShipmentItem.aggregate({
    where: { shipmentId: input.shipmentId },
    _max: { sortOrder: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const item = await tx.jobShipmentItem.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        shipmentId: input.shipmentId,
        workPackageId,
        fabricationItemId: fab?.id ?? null,
        description,
        quantity: qty,
        unit: input.unit?.trim() || null,
        notes: input.notes?.trim() || null,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
      include: {
        workPackage: { select: { id: true, name: true } },
        fabricationItem: { select: { id: true, name: true, quantity: true } },
      },
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "DELIVERY_LINE_ADDED",
        entityType: "JOB_SHIPMENT",
        entityId: input.shipmentId,
        actorUserId: input.actorUserId,
        newValue: { itemId: item.id, description: item.description },
      },
    });
    return item;
  });

  const full = await prisma.jobShipment.findFirstOrThrow({
    where: { id: input.shipmentId },
    include: shipmentInclude,
  });
  void created;
  return presentShipment(full);
}

export async function removeShipmentItem(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    shipmentId: string;
    itemId: string;
    actorUserId: string;
  }
) {
  const shipment = await prisma.jobShipment.findFirst({
    where: { id: input.shipmentId, workspaceId: input.workspaceId, jobId: input.jobId },
    select: { id: true, status: true },
  });
  if (!shipment) throw new DeliveryError("Delivery not found", 404);
  if (ACTIVE_HISTORY.has(shipment.status)) {
    throw new DeliveryError("Cannot remove lines from a shipped/delivered delivery", 409);
  }
  const item = await prisma.jobShipmentItem.findFirst({
    where: { id: input.itemId, shipmentId: input.shipmentId, jobId: input.jobId },
  });
  if (!item) throw new DeliveryError("Delivery line not found", 404);

  await prisma.$transaction(async (tx) => {
    await tx.jobShipmentItem.delete({ where: { id: item.id } });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "DELIVERY_LINE_REMOVED",
        entityType: "JOB_SHIPMENT",
        entityId: input.shipmentId,
        actorUserId: input.actorUserId,
        previousValue: { itemId: item.id, description: item.description },
      },
    });
  });

  const full = await prisma.jobShipment.findFirstOrThrow({
    where: { id: input.shipmentId },
    include: shipmentInclude,
  });
  return presentShipment(full);
}

export async function sumDeliveredQtyForFabricationItem(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    fabricationItemId: string;
    excludeShipmentId?: string;
  }
): Promise<Prisma.Decimal | null> {
  const lines = await prisma.jobShipmentItem.findMany({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      fabricationItemId: input.fabricationItemId,
      quantity: { not: null },
      shipment: {
        status: "DELIVERED",
        ...(input.excludeShipmentId ? { id: { not: input.excludeShipmentId } } : {}),
      },
    },
    select: { quantity: true },
  });
  let sum: Prisma.Decimal | null = null;
  for (const line of lines) {
    if (line.quantity == null) continue;
    const q = new PrismaNS.Decimal(line.quantity.toString());
    sum = sum == null ? q : sum.add(q);
  }
  return sum;
}

export function presentInstallation(row: any) {
  return {
    id: row.id,
    jobId: row.jobId,
    eventType: row.eventType,
    eventDate: toUtcDateOnly(row.eventDate),
    workPackage: row.workPackage,
    shipment: row.shipment
      ? { id: row.shipment.id, deliveryNumber: row.shipment.deliveryNumber, status: row.shipment.status }
      : null,
    participant: row.participant
      ? { id: row.participant.id, role: row.participant.role }
      : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const installationInclude = {
  workPackage: { select: { id: true, name: true } },
  shipment: { select: { id: true, deliveryNumber: true, status: true } },
  participant: { select: { id: true, role: true } },
} as const;

export async function listInstallations(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string }
) {
  const rows = await prisma.jobInstallationRecord.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: installationInclude,
    orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(presentInstallation);
}

export async function createInstallation(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    eventType?: JobInstallationEventType;
    eventDate?: string | null;
    workPackageId?: string | null;
    shipmentId?: string | null;
    participantId?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
) {
  await assertJob(prisma, input.workspaceId, input.jobId);
  await assertPackage(prisma, input.workspaceId, input.jobId, input.workPackageId);
  await assertParticipant(prisma, input.workspaceId, input.jobId, input.participantId);
  if (input.shipmentId) {
    const ship = await prisma.jobShipment.findFirst({
      where: { id: input.shipmentId, workspaceId: input.workspaceId, jobId: input.jobId },
      select: { id: true },
    });
    if (!ship) throw new DeliveryError("Delivery not found on this job", 404);
  }
  const eventDate = normalizeDate(input.eventDate ?? utcTodayYmd())!;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobInstallationRecord.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        eventType: input.eventType ?? "PROGRESS",
        eventDate,
        workPackageId: input.workPackageId ?? null,
        shipmentId: input.shipmentId ?? null,
        participantId: input.participantId ?? null,
        notes: input.notes?.trim() || null,
      },
      include: installationInclude,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "INSTALLATION_RECORDED",
        entityType: "JOB_INSTALLATION",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { eventType: row.eventType, eventDate: toUtcDateOnly(row.eventDate) },
      },
    });
    return row;
  });
  return presentInstallation(created);
}

export type DeliverySummary = {
  plannedCount: number;
  inTransitCount: number;
  lateCount: number;
  nextDelivery: {
    id: string;
    deliveryNumber: string;
    plannedDeliveryDate: string | null;
    packageNames: string[];
  } | null;
};

export async function buildDeliverySummary(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; now?: Date }
): Promise<DeliverySummary> {
  const now = input.now ?? new Date();
  const rows = await prisma.jobShipment.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: {
      items: { include: { workPackage: { select: { name: true } } } },
    },
    orderBy: [{ plannedDeliveryDate: "asc" }, { createdAt: "asc" }],
  });

  let plannedCount = 0;
  let inTransitCount = 0;
  let lateCount = 0;
  let nextDelivery: DeliverySummary["nextDelivery"] = null;

  for (const row of rows) {
    if (row.status === "PLANNED" || row.status === "READY") plannedCount += 1;
    if (row.status === "IN_TRANSIT") inTransitCount += 1;
    const risk = deriveDeliveryRisk(row, now);
    if (risk.atRisk) lateCount += 1;
    if (
      !nextDelivery &&
      (row.status === "PLANNED" || row.status === "READY" || row.status === "IN_TRANSIT") &&
      row.plannedDeliveryDate
    ) {
      const names = [
        ...new Set(
          row.items.map((i) => i.workPackage?.name).filter((n): n is string => Boolean(n))
        ),
      ];
      nextDelivery = {
        id: row.id,
        deliveryNumber: row.deliveryNumber,
        plannedDeliveryDate: toUtcDateOnly(row.plannedDeliveryDate),
        packageNames: names.slice(0, 3),
      };
    }
  }

  return { plannedCount, inTransitCount, lateCount, nextDelivery };
}

/** Package-scoped delivery aggregates for Scope — no full line hydration. */
export async function countDeliveriesByPackage(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string }
): Promise<Map<string, { deliveryCount: number; lastDeliveryDate: string | null }>> {
  const lines = await prisma.jobShipmentItem.findMany({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      workPackageId: { not: null },
      shipment: { status: { not: "CANCELLED" } },
    },
    select: {
      workPackageId: true,
      shipment: {
        select: { id: true, actualDeliveryDate: true, status: true },
      },
    },
  });

  const map = new Map<
    string,
    { shipmentIds: Set<string>; lastDeliveryDate: string | null }
  >();
  for (const line of lines) {
    const pkgId = line.workPackageId!;
    const cur = map.get(pkgId) ?? { shipmentIds: new Set(), lastDeliveryDate: null };
    cur.shipmentIds.add(line.shipment.id);
    const actual = toUtcDateOnly(line.shipment.actualDeliveryDate);
    if (actual && (cur.lastDeliveryDate == null || actual > cur.lastDeliveryDate)) {
      cur.lastDeliveryDate = actual;
    }
    map.set(pkgId, cur);
  }

  const out = new Map<string, { deliveryCount: number; lastDeliveryDate: string | null }>();
  for (const [id, cur] of map) {
    out.set(id, { deliveryCount: cur.shipmentIds.size, lastDeliveryDate: cur.lastDeliveryDate });
  }
  return out;
}

/** Block package delete when delivered/in-transit shipment history references it. */
export async function assertPackageDeletableForDeliveries(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; packageId: string }
): Promise<void> {
  const count = await prisma.jobShipmentItem.count({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      workPackageId: input.packageId,
      shipment: { status: { in: ["IN_TRANSIT", "DELIVERED"] } },
    },
  });
  if (count > 0) {
    throw new DeliveryError(
      "Cannot delete work package — delivered/in-transit shipment history references it",
      409
    );
  }
}
