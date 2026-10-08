import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";

export const JOB_RFQ_STATUSES = [
  "DRAFT",
  "REQUESTED",
  "RECEIVED",
  "DECLINED",
  "CANCELLED",
] as const;

export type JobRfqStatus = (typeof JOB_RFQ_STATUSES)[number];

export class JobRfqError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "JobRfqError";
  }
}

type Db = PrismaClient | Prisma.TransactionClient;

function decToString(v: PrismaNS.Decimal | null | undefined): string | null {
  if (v == null) return null;
  return v.toString();
}

function parseMoney(
  value: number | string | null | undefined
): PrismaNS.Decimal | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new JobRfqError("Invalid quotedAmount");
  }
  return new PrismaNS.Decimal(n);
}

function parseDateOnly(
  value: string | null | undefined
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new JobRfqError("Dates must be YYYY-MM-DD");
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export type JobRfqDto = {
  id: string;
  workspaceId: string;
  jobId: string;
  vendorId: string | null;
  vendorName: string | null;
  workPackageId: string | null;
  workPackageName: string | null;
  emailMessageId: string | null;
  title: string;
  description: string | null;
  status: JobRfqStatus;
  requestedDate: string | null;
  dueDate: string | null;
  receivedDate: string | null;
  quotedAmount: string | null;
  notes: string | null;
  documentRecordIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type JobRfqSummary = {
  totalCount: number;
  draftCount: number;
  requestedCount: number;
  receivedCount: number;
  outstandingCount: number;
};

function present(row: {
  id: string;
  workspaceId: string;
  jobId: string;
  vendorId: string | null;
  workPackageId: string | null;
  emailMessageId: string | null;
  title: string;
  description: string | null;
  status: string;
  requestedDate: Date | null;
  dueDate: Date | null;
  receivedDate: Date | null;
  quotedAmount: PrismaNS.Decimal | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  vendor?: { name: string } | null;
  workPackage?: { name: string } | null;
  documents?: Array<{ documentRecordId: string }>;
}): JobRfqDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    jobId: row.jobId,
    vendorId: row.vendorId,
    vendorName: row.vendor?.name ?? null,
    workPackageId: row.workPackageId,
    workPackageName: row.workPackage?.name ?? null,
    emailMessageId: row.emailMessageId,
    title: row.title,
    description: row.description,
    status: row.status as JobRfqStatus,
    requestedDate: row.requestedDate?.toISOString() ?? null,
    dueDate: row.dueDate?.toISOString() ?? null,
    receivedDate: row.receivedDate?.toISOString() ?? null,
    quotedAmount: decToString(row.quotedAmount),
    notes: row.notes,
    documentRecordIds: (row.documents ?? []).map((d) => d.documentRecordId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const include = {
  vendor: { select: { name: true } },
  workPackage: { select: { name: true } },
  documents: { select: { documentRecordId: true } },
} as const;

async function assertJob(db: Db, workspaceId: string, jobId: string) {
  const job = await db.job.findFirst({
    where: { id: jobId, workspaceId },
    select: { id: true },
  });
  if (!job) throw new JobRfqError("Job not found", 404);
}

export async function listJobRfqs(
  db: Db,
  input: { workspaceId: string; jobId: string }
): Promise<JobRfqDto[]> {
  await assertJob(db, input.workspaceId, input.jobId);
  const rows = await db.jobRfq.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(present);
}

export async function buildRfqSummary(
  db: Db,
  input: { workspaceId: string; jobId: string }
): Promise<JobRfqSummary> {
  const rows = await db.jobRfq.groupBy({
    by: ["status"],
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    _count: { _all: true },
  });
  const count = (status: JobRfqStatus) =>
    rows.find((r) => r.status === status)?._count._all ?? 0;
  const draftCount = count("DRAFT");
  const requestedCount = count("REQUESTED");
  const receivedCount = count("RECEIVED");
  const totalCount = rows.reduce((s, r) => s + r._count._all, 0);
  return {
    totalCount,
    draftCount,
    requestedCount,
    receivedCount,
    outstandingCount: draftCount + requestedCount,
  };
}

export async function createJobRfq(
  db: Db,
  input: {
    workspaceId: string;
    jobId: string;
    actorUserId: string;
    title: string;
    description?: string | null | undefined;
    vendorId?: string | null | undefined;
    workPackageId?: string | null | undefined;
    emailMessageId?: string | null | undefined;
    status?: JobRfqStatus | undefined;
    requestedDate?: string | null | undefined;
    dueDate?: string | null | undefined;
    receivedDate?: string | null | undefined;
    quotedAmount?: number | string | null | undefined;
    notes?: string | null | undefined;
  }
): Promise<JobRfqDto> {
  await assertJob(db, input.workspaceId, input.jobId);
  const title = input.title.trim();
  if (!title) throw new JobRfqError("Title is required");

  if (input.vendorId) {
    const v = await db.vendor.findFirst({
      where: { id: input.vendorId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!v) throw new JobRfqError("Vendor not found", 404);
  }
  if (input.workPackageId) {
    const wp = await db.jobWorkPackage.findFirst({
      where: {
        id: input.workPackageId,
        jobId: input.jobId,
        workspaceId: input.workspaceId,
      },
      select: { id: true },
    });
    if (!wp) throw new JobRfqError("Work package not found", 404);
  }
  if (input.emailMessageId) {
    const msg = await db.emailMessage.findFirst({
      where: { id: input.emailMessageId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!msg) throw new JobRfqError("Email not found", 404);
  }

  const created = await db.jobRfq.create({
    data: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      title,
      description: input.description?.trim() || null,
      vendorId: input.vendorId ?? null,
      workPackageId: input.workPackageId ?? null,
      emailMessageId: input.emailMessageId ?? null,
      status: input.status ?? "DRAFT",
      requestedDate: parseDateOnly(input.requestedDate) ?? null,
      dueDate: parseDateOnly(input.dueDate) ?? null,
      receivedDate: parseDateOnly(input.receivedDate) ?? null,
      quotedAmount: parseMoney(input.quotedAmount) ?? null,
      notes: input.notes?.trim() || null,
    },
    include,
  });

  await db.jobActivityLog.create({
    data: {
      jobId: input.jobId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "RFQ_CREATED",
      entityType: "JobRfq",
      entityId: created.id,
      newValue: { title: created.title, status: created.status },
    },
  });

  return present(created);
}

export async function updateJobRfq(
  db: Db,
  input: {
    workspaceId: string;
    jobId: string;
    rfqId: string;
    actorUserId: string;
    title?: string | undefined;
    description?: string | null | undefined;
    vendorId?: string | null | undefined;
    workPackageId?: string | null | undefined;
    emailMessageId?: string | null | undefined;
    status?: JobRfqStatus | undefined;
    requestedDate?: string | null | undefined;
    dueDate?: string | null | undefined;
    receivedDate?: string | null | undefined;
    quotedAmount?: number | string | null | undefined;
    notes?: string | null | undefined;
  }
): Promise<JobRfqDto> {
  const existing = await db.jobRfq.findFirst({
    where: {
      id: input.rfqId,
      jobId: input.jobId,
      workspaceId: input.workspaceId,
    },
  });
  if (!existing) throw new JobRfqError("RFQ not found", 404);

  if (input.vendorId) {
    const v = await db.vendor.findFirst({
      where: { id: input.vendorId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!v) throw new JobRfqError("Vendor not found", 404);
  }
  if (input.workPackageId) {
    const wp = await db.jobWorkPackage.findFirst({
      where: {
        id: input.workPackageId,
        jobId: input.jobId,
        workspaceId: input.workspaceId,
      },
      select: { id: true },
    });
    if (!wp) throw new JobRfqError("Work package not found", 404);
  }

  const statusChanged =
    input.status !== undefined && input.status !== existing.status;

  const updated = await db.jobRfq.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
      ...(input.workPackageId !== undefined
        ? { workPackageId: input.workPackageId }
        : {}),
      ...(input.emailMessageId !== undefined
        ? { emailMessageId: input.emailMessageId }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.requestedDate !== undefined
        ? { requestedDate: parseDateOnly(input.requestedDate) ?? null }
        : {}),
      ...(input.dueDate !== undefined
        ? { dueDate: parseDateOnly(input.dueDate) ?? null }
        : {}),
      ...(input.receivedDate !== undefined
        ? { receivedDate: parseDateOnly(input.receivedDate) ?? null }
        : {}),
      ...(input.quotedAmount !== undefined
        ? { quotedAmount: parseMoney(input.quotedAmount) ?? null }
        : {}),
      ...(input.notes !== undefined
        ? { notes: input.notes?.trim() || null }
        : {}),
    },
    include,
  });

  await db.jobActivityLog.create({
    data: {
      jobId: input.jobId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: statusChanged ? "RFQ_STATUS_CHANGED" : "RFQ_UPDATED",
      entityType: "JobRfq",
      entityId: updated.id,
      ...(statusChanged
        ? {
            previousValue: { status: existing.status },
            newValue: { status: updated.status },
          }
        : {
            newValue: { title: updated.title },
          }),
    },
  });

  return present(updated);
}

export async function deleteJobRfq(
  db: Db,
  input: {
    workspaceId: string;
    jobId: string;
    rfqId: string;
    actorUserId: string;
  }
): Promise<void> {
  const existing = await db.jobRfq.findFirst({
    where: {
      id: input.rfqId,
      jobId: input.jobId,
      workspaceId: input.workspaceId,
    },
    select: { id: true, title: true },
  });
  if (!existing) throw new JobRfqError("RFQ not found", 404);

  await db.jobRfq.delete({ where: { id: existing.id } });
  await db.jobActivityLog.create({
    data: {
      jobId: input.jobId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "RFQ_DELETED",
      entityType: "JobRfq",
      entityId: existing.id,
      previousValue: { title: existing.title },
    },
  });
}
