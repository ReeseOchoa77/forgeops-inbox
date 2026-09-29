import type {
  JobChangeOrderStatus,
  JobChangeStatus,
  JobChangeType,
  JobDirectiveStatus,
  JobDirectiveType,
  JobRfiStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { safeDateOrNull } from "@forgeops/shared";

export class ChangeMgmtError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "ChangeMgmtError";
  }
}

export const RFI_STATUSES = ["DRAFT", "OPEN", "ANSWERED", "CLOSED", "CANCELLED"] as const satisfies readonly JobRfiStatus[];
export const DIRECTIVE_TYPES = ["ASI", "BULLETIN", "ADDENDUM", "OTHER"] as const satisfies readonly JobDirectiveType[];
export const DIRECTIVE_STATUSES = ["ACTIVE", "VOID"] as const satisfies readonly JobDirectiveStatus[];
export const CHANGE_TYPES = ["EXTRA", "CREDIT", "SCOPE_CHANGE", "REWORK", "BACKCHARGE", "OTHER"] as const satisfies readonly JobChangeType[];
export const CHANGE_STATUSES = ["IDENTIFIED", "PRICING", "PROPOSED", "APPROVED", "REJECTED", "VOID"] as const satisfies readonly JobChangeStatus[];
export const CHANGE_ORDER_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "VOID"] as const satisfies readonly JobChangeOrderStatus[];

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
  if (!parsed) throw new ChangeMgmtError("Invalid date", 400);
  const ymd = toUtcDateOnly(parsed);
  if (!ymd) throw new ChangeMgmtError("Invalid date", 400);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function utcTodayYmd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Money: null stays null (unknown); number becomes Decimal. Distinguishes NULL vs 0. */
export function normalizeMoney(raw: unknown): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new ChangeMgmtError("Invalid money amount", 400);
  return new PrismaNS.Decimal(n.toFixed(2));
}

export function moneyToString(value: { toString(): string } | null | undefined): string | null {
  if (value == null) return null;
  // Always two decimal places so API clients can distinguish "0.00" from null (unknown).
  return new PrismaNS.Decimal(value.toString()).toFixed(2);
}

export function isRfiOverdue(
  status: JobRfiStatus,
  responseDueDate: Date | string | null | undefined,
  now = new Date()
): boolean {
  if (status !== "OPEN" && status !== "DRAFT") return false;
  const due = toUtcDateOnly(responseDueDate);
  if (!due) return false;
  return due < utcTodayYmd(now);
}

async function assertPackages(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  packageIds: string[]
): Promise<void> {
  if (!packageIds.length) return;
  const rows = await prisma.jobWorkPackage.findMany({
    where: { workspaceId, jobId, id: { in: packageIds } },
    select: { id: true },
  });
  if (rows.length !== new Set(packageIds).size) {
    throw new ChangeMgmtError("Work package not found on this job", 404);
  }
}

async function assertDocuments(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  documentIds: string[]
): Promise<void> {
  if (!documentIds.length) return;
  const rows = await prisma.jobDocumentRecord.findMany({
    where: { workspaceId, jobId, id: { in: documentIds } },
    select: { id: true },
  });
  if (rows.length !== new Set(documentIds).size) {
    throw new ChangeMgmtError("Document record not found on this job", 404);
  }
}

async function assertParticipant(
  prisma: PrismaClient,
  workspaceId: string,
  jobId: string,
  participantId: string | null | undefined
): Promise<void> {
  if (!participantId) return;
  const row = await prisma.jobParticipant.findFirst({
    where: { id: participantId, workspaceId, jobId },
    select: { id: true },
  });
  if (!row) throw new ChangeMgmtError("Participant not found on this job", 404);
}

async function assertActiveNumberUnique(
  prisma: PrismaClient,
  input: {
    jobId: string;
    number: string;
    kind: "rfi" | "directive" | "change" | "changeOrder";
    excludeId?: string;
  }
): Promise<void> {
  const number = input.number.trim();
  if (!number) throw new ChangeMgmtError("Number is required", 400);
  if (input.kind === "rfi") {
    const clash = await prisma.jobRfi.findFirst({
      where: {
        jobId: input.jobId,
        number: { equals: number, mode: "insensitive" },
        status: { not: "CANCELLED" },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ChangeMgmtError("An active RFI with this number already exists on this job", 409);
  } else if (input.kind === "directive") {
    const clash = await prisma.jobDirective.findFirst({
      where: {
        jobId: input.jobId,
        number: { equals: number, mode: "insensitive" },
        status: { not: "VOID" },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ChangeMgmtError("An active directive with this number already exists on this job", 409);
  } else if (input.kind === "change") {
    const clash = await prisma.jobChange.findFirst({
      where: {
        jobId: input.jobId,
        number: { equals: number, mode: "insensitive" },
        status: { not: "VOID" },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ChangeMgmtError("An active change with this number already exists on this job", 409);
  } else {
    const clash = await prisma.jobChangeOrder.findFirst({
      where: {
        jobId: input.jobId,
        number: { equals: number, mode: "insensitive" },
        status: { not: "VOID" },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ChangeMgmtError("An active change order with this number already exists on this job", 409);
  }
}

function presentPkgLinks(links: Array<{ workPackage: { id: string; name: string } }>) {
  return links.map((l) => ({ id: l.workPackage.id, name: l.workPackage.name }));
}

function presentDocLinks(
  links: Array<{ documentRecord: { id: string; documentNumber: string | null; title: string | null; documentType: string } }>
) {
  return links.map((l) => ({
    id: l.documentRecord.id,
    documentNumber: l.documentRecord.documentNumber,
    title: l.documentRecord.title,
    documentType: l.documentRecord.documentType,
  }));
}

function presentParticipant(
  p: { id: string; role: string; user?: { name: string | null; email: string } | null; customer?: { name: string } | null; vendor?: { name: string } | null; contact?: { name: string } | null } | null
) {
  if (!p) return null;
  const name =
    p.user?.name?.trim() ||
    p.user?.email ||
    p.customer?.name ||
    p.vendor?.name ||
    p.contact?.name ||
    "Participant";
  return { id: p.id, role: p.role, name };
}

const rfiInclude = {
  workPackages: { include: { workPackage: { select: { id: true, name: true } } } },
  documents: {
    include: {
      documentRecord: { select: { id: true, documentNumber: true, title: true, documentType: true } },
    },
  },
  requestedBy: {
    include: {
      user: { select: { name: true, email: true } },
      customer: { select: { name: true } },
      vendor: { select: { name: true } },
      contact: { select: { name: true } },
    },
  },
  assignedTo: {
    include: {
      user: { select: { name: true, email: true } },
      customer: { select: { name: true } },
      vendor: { select: { name: true } },
      contact: { select: { name: true } },
    },
  },
  changes: { select: { id: true, number: true, title: true, status: true } },
} as const;

export function presentRfi(row: any, now = new Date()) {
  return {
    id: row.id,
    jobId: row.jobId,
    number: row.number,
    subject: row.subject,
    question: row.question,
    status: row.status,
    submittedDate: toUtcDateOnly(row.submittedDate),
    responseDueDate: toUtcDateOnly(row.responseDueDate),
    answeredDate: toUtcDateOnly(row.answeredDate),
    response: row.response,
    overdue: isRfiOverdue(row.status, row.responseDueDate, now),
    requestedBy: presentParticipant(row.requestedBy),
    assignedTo: presentParticipant(row.assignedTo),
    workPackages: presentPkgLinks(row.workPackages ?? []),
    documents: presentDocLinks(row.documents ?? []),
    changes: row.changes ?? [],
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRfis(prisma: PrismaClient, input: { workspaceId: string; jobId: string }) {
  const rows = await prisma.jobRfi.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: rfiInclude,
    orderBy: [{ submittedDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => presentRfi(r));
}

export async function createRfi(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    number: string;
    subject: string;
    question?: string | null;
    status?: JobRfiStatus;
    submittedDate?: string | null;
    responseDueDate?: string | null;
    requestedByParticipantId?: string | null;
    assignedToParticipantId?: string | null;
    workPackageIds?: string[];
    documentRecordIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) throw new ChangeMgmtError("Job not found", 404);
  await assertActiveNumberUnique(prisma, { jobId: input.jobId, number: input.number, kind: "rfi" });
  await assertPackages(prisma, input.workspaceId, input.jobId, input.workPackageIds ?? []);
  await assertDocuments(prisma, input.workspaceId, input.jobId, input.documentRecordIds ?? []);
  await assertParticipant(prisma, input.workspaceId, input.jobId, input.requestedByParticipantId);
  await assertParticipant(prisma, input.workspaceId, input.jobId, input.assignedToParticipantId);

  const subject = input.subject.trim();
  if (!subject) throw new ChangeMgmtError("Subject is required", 400);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobRfi.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        number: input.number.trim(),
        subject,
        question: input.question?.trim() || null,
        status: input.status ?? "OPEN",
        submittedDate: input.submittedDate !== undefined ? normalizeDate(input.submittedDate) : normalizeDate(utcTodayYmd()),
        responseDueDate: input.responseDueDate !== undefined ? normalizeDate(input.responseDueDate) : null,
        requestedByParticipantId: input.requestedByParticipantId ?? null,
        assignedToParticipantId: input.assignedToParticipantId ?? null,
        notes: input.notes?.trim() || null,
        workPackages: {
          create: (input.workPackageIds ?? []).map((workPackageId) => ({ workPackageId })),
        },
        documents: {
          create: (input.documentRecordIds ?? []).map((documentRecordId) => ({ documentRecordId })),
        },
      },
      include: rfiInclude,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "RFI_CREATED",
        entityType: "JOB_RFI",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { number: row.number, status: row.status },
      },
    });
    return row;
  });
  return presentRfi(created);
}

export async function updateRfi(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    rfiId: string;
    number?: string;
    subject?: string;
    question?: string | null;
    status?: JobRfiStatus;
    submittedDate?: string | null;
    responseDueDate?: string | null;
    answeredDate?: string | null;
    response?: string | null;
    requestedByParticipantId?: string | null;
    assignedToParticipantId?: string | null;
    workPackageIds?: string[];
    documentRecordIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const existing = await prisma.jobRfi.findFirst({
    where: { id: input.rfiId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!existing) throw new ChangeMgmtError("RFI not found", 404);

  if (input.number !== undefined) {
    await assertActiveNumberUnique(prisma, {
      jobId: input.jobId,
      number: input.number,
      kind: "rfi",
      excludeId: input.rfiId,
    });
  }
  if (input.workPackageIds) await assertPackages(prisma, input.workspaceId, input.jobId, input.workPackageIds);
  if (input.documentRecordIds) await assertDocuments(prisma, input.workspaceId, input.jobId, input.documentRecordIds);
  if (input.requestedByParticipantId !== undefined) {
    await assertParticipant(prisma, input.workspaceId, input.jobId, input.requestedByParticipantId);
  }
  if (input.assignedToParticipantId !== undefined) {
    await assertParticipant(prisma, input.workspaceId, input.jobId, input.assignedToParticipantId);
  }

  let nextStatus = input.status ?? existing.status;
  let answeredDate =
    input.answeredDate !== undefined ? normalizeDate(input.answeredDate) : existing.answeredDate;
  if (input.status === "ANSWERED" && existing.status !== "ANSWERED") {
    if (input.answeredDate === undefined) answeredDate = normalizeDate(utcTodayYmd());
  }
  if (input.status === "OPEN" && (existing.status === "ANSWERED" || existing.status === "CLOSED")) {
    // reopen keeps answeredDate unless cleared
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.workPackageIds) {
      await tx.jobRfiWorkPackage.deleteMany({ where: { rfiId: input.rfiId } });
      if (input.workPackageIds.length) {
        await tx.jobRfiWorkPackage.createMany({
          data: input.workPackageIds.map((workPackageId) => ({ rfiId: input.rfiId, workPackageId })),
        });
      }
    }
    if (input.documentRecordIds) {
      await tx.jobRfiDocument.deleteMany({ where: { rfiId: input.rfiId } });
      if (input.documentRecordIds.length) {
        await tx.jobRfiDocument.createMany({
          data: input.documentRecordIds.map((documentRecordId) => ({
            rfiId: input.rfiId,
            documentRecordId,
          })),
        });
      }
    }

    const row = await tx.jobRfi.update({
      where: { id: input.rfiId },
      data: {
        ...(input.number !== undefined ? { number: input.number.trim() } : {}),
        ...(input.subject !== undefined ? { subject: input.subject.trim() } : {}),
        ...(input.question !== undefined ? { question: input.question?.trim() || null } : {}),
        status: nextStatus,
        ...(input.submittedDate !== undefined ? { submittedDate: normalizeDate(input.submittedDate) } : {}),
        ...(input.responseDueDate !== undefined
          ? { responseDueDate: normalizeDate(input.responseDueDate) }
          : {}),
        answeredDate,
        ...(input.response !== undefined ? { response: input.response?.trim() || null } : {}),
        ...(input.requestedByParticipantId !== undefined
          ? { requestedByParticipantId: input.requestedByParticipantId }
          : {}),
        ...(input.assignedToParticipantId !== undefined
          ? { assignedToParticipantId: input.assignedToParticipantId }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: rfiInclude,
    });

    let action: "RFI_UPDATED" | "RFI_ANSWERED" | "RFI_CLOSED" | "RFI_CANCELLED" = "RFI_UPDATED";
    if (existing.status !== nextStatus) {
      if (nextStatus === "ANSWERED") action = "RFI_ANSWERED";
      else if (nextStatus === "CLOSED") action = "RFI_CLOSED";
      else if (nextStatus === "CANCELLED") action = "RFI_CANCELLED";
    }
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action,
        entityType: "JOB_RFI",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: { status: existing.status, number: existing.number },
        newValue: { status: row.status, number: row.number },
      },
    });
    return row;
  });
  return presentRfi(updated);
}

export async function deleteRfi(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; rfiId: string; actorUserId: string }
) {
  const existing = await prisma.jobRfi.findFirst({
    where: { id: input.rfiId, workspaceId: input.workspaceId, jobId: input.jobId },
    include: { changes: { select: { id: true } } },
  });
  if (!existing) throw new ChangeMgmtError("RFI not found", 404);
  if (existing.changes.length > 0) {
    throw new ChangeMgmtError("Cancel the RFI instead — linked Changes exist", 409);
  }
  if (existing.status !== "DRAFT" && existing.status !== "CANCELLED") {
    throw new ChangeMgmtError("Only draft or cancelled RFIs can be deleted; cancel instead", 409);
  }
  await prisma.jobRfi.delete({ where: { id: existing.id } });
}

const directiveInclude = {
  workPackages: { include: { workPackage: { select: { id: true, name: true } } } },
  documents: {
    include: {
      documentRecord: { select: { id: true, documentNumber: true, title: true, documentType: true } },
    },
  },
  changes: { select: { id: true, number: true, title: true, status: true } },
} as const;

export function presentDirective(row: any) {
  return {
    id: row.id,
    jobId: row.jobId,
    type: row.type,
    status: row.status,
    number: row.number,
    title: row.title,
    issuedDate: toUtcDateOnly(row.issuedDate),
    summary: row.summary,
    notes: row.notes,
    workPackages: presentPkgLinks(row.workPackages ?? []),
    documents: presentDocLinks(row.documents ?? []),
    changes: row.changes ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDirectives(prisma: PrismaClient, input: { workspaceId: string; jobId: string }) {
  const rows = await prisma.jobDirective.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: directiveInclude,
    orderBy: [{ issuedDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(presentDirective);
}

export async function createDirective(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    type: JobDirectiveType;
    number: string;
    title: string;
    issuedDate?: string | null;
    summary?: string | null;
    workPackageIds?: string[];
    documentRecordIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) throw new ChangeMgmtError("Job not found", 404);
  await assertActiveNumberUnique(prisma, { jobId: input.jobId, number: input.number, kind: "directive" });
  await assertPackages(prisma, input.workspaceId, input.jobId, input.workPackageIds ?? []);
  await assertDocuments(prisma, input.workspaceId, input.jobId, input.documentRecordIds ?? []);
  const title = input.title.trim();
  if (!title) throw new ChangeMgmtError("Title is required", 400);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobDirective.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        type: input.type,
        number: input.number.trim(),
        title,
        issuedDate: input.issuedDate !== undefined ? normalizeDate(input.issuedDate) : normalizeDate(utcTodayYmd()),
        summary: input.summary?.trim() || null,
        notes: input.notes?.trim() || null,
        workPackages: {
          create: (input.workPackageIds ?? []).map((workPackageId) => ({ workPackageId })),
        },
        documents: {
          create: (input.documentRecordIds ?? []).map((documentRecordId) => ({ documentRecordId })),
        },
      },
      include: directiveInclude,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "DIRECTIVE_CREATED",
        entityType: "JOB_DIRECTIVE",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { number: row.number, type: row.type },
      },
    });
    return row;
  });
  return presentDirective(created);
}

export async function updateDirective(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    directiveId: string;
    type?: JobDirectiveType;
    status?: JobDirectiveStatus;
    number?: string;
    title?: string;
    issuedDate?: string | null;
    summary?: string | null;
    workPackageIds?: string[];
    documentRecordIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const existing = await prisma.jobDirective.findFirst({
    where: { id: input.directiveId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!existing) throw new ChangeMgmtError("Directive not found", 404);
  if (input.number !== undefined) {
    await assertActiveNumberUnique(prisma, {
      jobId: input.jobId,
      number: input.number,
      kind: "directive",
      excludeId: input.directiveId,
    });
  }
  if (input.workPackageIds) await assertPackages(prisma, input.workspaceId, input.jobId, input.workPackageIds);
  if (input.documentRecordIds) await assertDocuments(prisma, input.workspaceId, input.jobId, input.documentRecordIds);

  const nextStatus = input.status ?? existing.status;
  const updated = await prisma.$transaction(async (tx) => {
    if (input.workPackageIds) {
      await tx.jobDirectiveWorkPackage.deleteMany({ where: { directiveId: input.directiveId } });
      if (input.workPackageIds.length) {
        await tx.jobDirectiveWorkPackage.createMany({
          data: input.workPackageIds.map((workPackageId) => ({
            directiveId: input.directiveId,
            workPackageId,
          })),
        });
      }
    }
    if (input.documentRecordIds) {
      await tx.jobDirectiveDocument.deleteMany({ where: { directiveId: input.directiveId } });
      if (input.documentRecordIds.length) {
        await tx.jobDirectiveDocument.createMany({
          data: input.documentRecordIds.map((documentRecordId) => ({
            directiveId: input.directiveId,
            documentRecordId,
          })),
        });
      }
    }
    const row = await tx.jobDirective.update({
      where: { id: input.directiveId },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        status: nextStatus,
        ...(input.number !== undefined ? { number: input.number.trim() } : {}),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.issuedDate !== undefined ? { issuedDate: normalizeDate(input.issuedDate) } : {}),
        ...(input.summary !== undefined ? { summary: input.summary?.trim() || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: directiveInclude,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: nextStatus === "VOID" && existing.status !== "VOID" ? "DIRECTIVE_VOIDED" : "DIRECTIVE_UPDATED",
        entityType: "JOB_DIRECTIVE",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: { status: existing.status, number: existing.number },
        newValue: { status: row.status, number: row.number },
      },
    });
    return row;
  });
  return presentDirective(updated);
}

const changeInclude = {
  workPackages: { include: { workPackage: { select: { id: true, name: true } } } },
  sourceRfi: { select: { id: true, number: true, subject: true } },
  sourceDirective: { select: { id: true, number: true, title: true, type: true } },
  changeOrder: { select: { id: true, number: true, status: true } },
} as const;

export function presentChange(row: any) {
  return {
    id: row.id,
    jobId: row.jobId,
    number: row.number,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    sourceRfi: row.sourceRfi,
    sourceDirective: row.sourceDirective,
    changeOrder: row.changeOrder,
    costImpact: moneyToString(row.costImpact),
    sellImpact: moneyToString(row.sellImpact),
    scheduleImpactDays: row.scheduleImpactDays,
    scheduleImpactNote: row.scheduleImpactNote,
    identifiedDate: toUtcDateOnly(row.identifiedDate),
    proposedDate: toUtcDateOnly(row.proposedDate),
    approvedDate: toUtcDateOnly(row.approvedDate),
    workPackages: presentPkgLinks(row.workPackages ?? []),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listChanges(prisma: PrismaClient, input: { workspaceId: string; jobId: string }) {
  const rows = await prisma.jobChange.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: changeInclude,
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(presentChange);
}

export async function createChange(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    number: string;
    title: string;
    description?: string | null;
    type?: JobChangeType;
    status?: JobChangeStatus;
    sourceRfiId?: string | null;
    sourceDirectiveId?: string | null;
    costImpact?: unknown;
    sellImpact?: unknown;
    scheduleImpactDays?: number | null;
    scheduleImpactNote?: string | null;
    workPackageIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) throw new ChangeMgmtError("Job not found", 404);
  await assertActiveNumberUnique(prisma, { jobId: input.jobId, number: input.number, kind: "change" });
  await assertPackages(prisma, input.workspaceId, input.jobId, input.workPackageIds ?? []);
  if (input.sourceRfiId) {
    const rfi = await prisma.jobRfi.findFirst({
      where: { id: input.sourceRfiId, workspaceId: input.workspaceId, jobId: input.jobId },
      select: { id: true },
    });
    if (!rfi) throw new ChangeMgmtError("Source RFI not found on this job", 404);
  }
  if (input.sourceDirectiveId) {
    const dir = await prisma.jobDirective.findFirst({
      where: { id: input.sourceDirectiveId, workspaceId: input.workspaceId, jobId: input.jobId },
      select: { id: true },
    });
    if (!dir) throw new ChangeMgmtError("Source directive not found on this job", 404);
  }
  const title = input.title.trim();
  if (!title) throw new ChangeMgmtError("Title is required", 400);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobChange.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        number: input.number.trim(),
        title,
        description: input.description?.trim() || null,
        type: input.type ?? "SCOPE_CHANGE",
        status: input.status ?? "IDENTIFIED",
        sourceRfiId: input.sourceRfiId ?? null,
        sourceDirectiveId: input.sourceDirectiveId ?? null,
        costImpact: input.costImpact !== undefined ? normalizeMoney(input.costImpact) : null,
        sellImpact: input.sellImpact !== undefined ? normalizeMoney(input.sellImpact) : null,
        scheduleImpactDays: input.scheduleImpactDays ?? null,
        scheduleImpactNote: input.scheduleImpactNote?.trim() || null,
        identifiedDate: normalizeDate(utcTodayYmd()),
        notes: input.notes?.trim() || null,
        workPackages: {
          create: (input.workPackageIds ?? []).map((workPackageId) => ({ workPackageId })),
        },
      },
      include: changeInclude,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "CHANGE_CREATED",
        entityType: "JOB_CHANGE",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { number: row.number, status: row.status },
      },
    });
    return row;
  });
  return presentChange(created);
}

export async function updateChange(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    changeId: string;
    number?: string;
    title?: string;
    description?: string | null;
    type?: JobChangeType;
    status?: JobChangeStatus;
    sourceRfiId?: string | null;
    sourceDirectiveId?: string | null;
    changeOrderId?: string | null;
    costImpact?: unknown;
    sellImpact?: unknown;
    scheduleImpactDays?: number | null;
    scheduleImpactNote?: string | null;
    workPackageIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const existing = await prisma.jobChange.findFirst({
    where: { id: input.changeId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!existing) throw new ChangeMgmtError("Change not found", 404);
  if (input.number !== undefined) {
    await assertActiveNumberUnique(prisma, {
      jobId: input.jobId,
      number: input.number,
      kind: "change",
      excludeId: input.changeId,
    });
  }
  if (input.workPackageIds) await assertPackages(prisma, input.workspaceId, input.jobId, input.workPackageIds);
  if (input.sourceRfiId) {
    const rfi = await prisma.jobRfi.findFirst({
      where: { id: input.sourceRfiId, workspaceId: input.workspaceId, jobId: input.jobId },
      select: { id: true },
    });
    if (!rfi) throw new ChangeMgmtError("Source RFI not found on this job", 404);
  }
  if (input.sourceDirectiveId) {
    const dir = await prisma.jobDirective.findFirst({
      where: { id: input.sourceDirectiveId, workspaceId: input.workspaceId, jobId: input.jobId },
      select: { id: true },
    });
    if (!dir) throw new ChangeMgmtError("Source directive not found on this job", 404);
  }
  if (input.changeOrderId) {
    const co = await prisma.jobChangeOrder.findFirst({
      where: { id: input.changeOrderId, workspaceId: input.workspaceId, jobId: input.jobId },
      select: { id: true },
    });
    if (!co) throw new ChangeMgmtError("Change order not found on this job", 404);
  }

  const nextStatus = input.status ?? existing.status;
  let proposedDate = existing.proposedDate;
  let approvedDate = existing.approvedDate;
  if (input.status === "PROPOSED" && existing.status !== "PROPOSED") {
    proposedDate = normalizeDate(utcTodayYmd());
  }
  if (input.status === "APPROVED" && existing.status !== "APPROVED") {
    approvedDate = normalizeDate(utcTodayYmd());
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.workPackageIds) {
      await tx.jobChangeWorkPackage.deleteMany({ where: { changeId: input.changeId } });
      if (input.workPackageIds.length) {
        await tx.jobChangeWorkPackage.createMany({
          data: input.workPackageIds.map((workPackageId) => ({
            changeId: input.changeId,
            workPackageId,
          })),
        });
      }
    }
    const row = await tx.jobChange.update({
      where: { id: input.changeId },
      data: {
        ...(input.number !== undefined ? { number: input.number.trim() } : {}),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        status: nextStatus,
        ...(input.sourceRfiId !== undefined ? { sourceRfiId: input.sourceRfiId } : {}),
        ...(input.sourceDirectiveId !== undefined ? { sourceDirectiveId: input.sourceDirectiveId } : {}),
        ...(input.changeOrderId !== undefined ? { changeOrderId: input.changeOrderId } : {}),
        ...(input.costImpact !== undefined ? { costImpact: normalizeMoney(input.costImpact) } : {}),
        ...(input.sellImpact !== undefined ? { sellImpact: normalizeMoney(input.sellImpact) } : {}),
        ...(input.scheduleImpactDays !== undefined
          ? { scheduleImpactDays: input.scheduleImpactDays }
          : {}),
        ...(input.scheduleImpactNote !== undefined
          ? { scheduleImpactNote: input.scheduleImpactNote?.trim() || null }
          : {}),
        proposedDate,
        approvedDate,
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: changeInclude,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: existing.status !== nextStatus ? "CHANGE_STATUS_CHANGED" : "CHANGE_UPDATED",
        entityType: "JOB_CHANGE",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: { status: existing.status, number: existing.number },
        newValue: { status: row.status, number: row.number },
      },
    });
    return row;
  });
  return presentChange(updated);
}

export function presentChangeOrder(row: any) {
  return {
    id: row.id,
    jobId: row.jobId,
    number: row.number,
    title: row.title,
    status: row.status,
    submittedDate: toUtcDateOnly(row.submittedDate),
    approvedDate: toUtcDateOnly(row.approvedDate),
    sellAmount: moneyToString(row.sellAmount),
    notes: row.notes,
    changes: (row.changes ?? []).map((c: any) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      status: c.status,
      sellImpact: moneyToString(c.sellImpact),
      costImpact: moneyToString(c.costImpact),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listChangeOrders(prisma: PrismaClient, input: { workspaceId: string; jobId: string }) {
  const rows = await prisma.jobChangeOrder.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: {
      changes: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          sellImpact: true,
          costImpact: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(presentChangeOrder);
}

export async function createChangeOrder(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    number: string;
    title?: string | null;
    status?: JobChangeOrderStatus;
    sellAmount?: unknown;
    changeIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) throw new ChangeMgmtError("Job not found", 404);
  await assertActiveNumberUnique(prisma, { jobId: input.jobId, number: input.number, kind: "changeOrder" });
  const changeIds = input.changeIds ?? [];
  if (changeIds.length) {
    const changes = await prisma.jobChange.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId, id: { in: changeIds } },
      select: { id: true, changeOrderId: true },
    });
    if (changes.length !== changeIds.length) {
      throw new ChangeMgmtError("Change not found on this job", 404);
    }
    if (changes.some((c) => c.changeOrderId)) {
      throw new ChangeMgmtError("One or more changes already belong to a change order", 409);
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobChangeOrder.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        number: input.number.trim(),
        title: input.title?.trim() || null,
        status: input.status ?? "DRAFT",
        sellAmount: input.sellAmount !== undefined ? normalizeMoney(input.sellAmount) : null,
        notes: input.notes?.trim() || null,
      },
    });
    if (changeIds.length) {
      await tx.jobChange.updateMany({
        where: { id: { in: changeIds }, jobId: input.jobId },
        data: { changeOrderId: row.id },
      });
    }
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "CHANGE_ORDER_CREATED",
        entityType: "JOB_CHANGE_ORDER",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { number: row.number, status: row.status, changeCount: changeIds.length },
      },
    });
    return tx.jobChangeOrder.findFirstOrThrow({
      where: { id: row.id },
      include: {
        changes: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            sellImpact: true,
            costImpact: true,
          },
        },
      },
    });
  });
  return presentChangeOrder(created);
}

export async function updateChangeOrder(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    changeOrderId: string;
    number?: string;
    title?: string | null;
    status?: JobChangeOrderStatus;
    sellAmount?: unknown;
    submittedDate?: string | null;
    approvedDate?: string | null;
    changeIds?: string[];
    notes?: string | null;
    actorUserId: string;
  }
) {
  const existing = await prisma.jobChangeOrder.findFirst({
    where: { id: input.changeOrderId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!existing) throw new ChangeMgmtError("Change order not found", 404);
  if (input.number !== undefined) {
    await assertActiveNumberUnique(prisma, {
      jobId: input.jobId,
      number: input.number,
      kind: "changeOrder",
      excludeId: input.changeOrderId,
    });
  }
  if (input.changeIds) {
    const changes = await prisma.jobChange.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId, id: { in: input.changeIds } },
      select: { id: true, changeOrderId: true },
    });
    if (changes.length !== input.changeIds.length) {
      throw new ChangeMgmtError("Change not found on this job", 404);
    }
    if (changes.some((c) => c.changeOrderId && c.changeOrderId !== input.changeOrderId)) {
      throw new ChangeMgmtError("One or more changes already belong to another change order", 409);
    }
  }

  const nextStatus = input.status ?? existing.status;
  let submittedDate =
    input.submittedDate !== undefined ? normalizeDate(input.submittedDate) : existing.submittedDate;
  let approvedDate =
    input.approvedDate !== undefined ? normalizeDate(input.approvedDate) : existing.approvedDate;
  if (input.status === "SUBMITTED" && existing.status !== "SUBMITTED" && input.submittedDate === undefined) {
    submittedDate = normalizeDate(utcTodayYmd());
  }
  if (input.status === "APPROVED" && existing.status !== "APPROVED" && input.approvedDate === undefined) {
    approvedDate = normalizeDate(utcTodayYmd());
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.changeIds) {
      await tx.jobChange.updateMany({
        where: { changeOrderId: input.changeOrderId, jobId: input.jobId },
        data: { changeOrderId: null },
      });
      if (input.changeIds.length) {
        await tx.jobChange.updateMany({
          where: { id: { in: input.changeIds }, jobId: input.jobId },
          data: { changeOrderId: input.changeOrderId },
        });
      }
    }
    const row = await tx.jobChangeOrder.update({
      where: { id: input.changeOrderId },
      data: {
        ...(input.number !== undefined ? { number: input.number.trim() } : {}),
        ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
        status: nextStatus,
        ...(input.sellAmount !== undefined ? { sellAmount: normalizeMoney(input.sellAmount) } : {}),
        submittedDate,
        approvedDate,
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: {
        changes: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            sellImpact: true,
            costImpact: true,
          },
        },
      },
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action:
          existing.status !== nextStatus ? "CHANGE_ORDER_STATUS_CHANGED" : "CHANGE_ORDER_UPDATED",
        entityType: "JOB_CHANGE_ORDER",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: { status: existing.status, number: existing.number },
        newValue: { status: row.status, number: row.number },
      },
    });
    return row;
  });
  return presentChangeOrder(updated);
}

export type ChangesSummary = {
  openRfiCount: number;
  overdueRfiCount: number;
  proposedChangeCount: number;
  proposedSellImpact: string | null;
  pendingChangeOrderCount: number;
};

export async function buildChangesSummary(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; now?: Date }
): Promise<ChangesSummary> {
  const now = input.now ?? new Date();
  const [rfis, changes, cos] = await Promise.all([
    prisma.jobRfi.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId },
      select: { status: true, responseDueDate: true },
    }),
    prisma.jobChange.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId },
      select: { status: true, sellImpact: true },
    }),
    prisma.jobChangeOrder.count({
      where: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        status: { in: ["DRAFT", "SUBMITTED"] },
      },
    }),
  ]);
  const openRfis = rfis.filter((r) => r.status === "OPEN" || r.status === "DRAFT");
  const overdueRfiCount = openRfis.filter((r) => isRfiOverdue(r.status, r.responseDueDate, now)).length;
  const proposed = changes.filter((c) => c.status === "PROPOSED" || c.status === "PRICING");
  let proposedSum: Prisma.Decimal | null = null;
  for (const c of proposed) {
    if (c.sellImpact == null) continue;
    proposedSum = proposedSum == null ? c.sellImpact : proposedSum.add(c.sellImpact);
  }
  return {
    openRfiCount: openRfis.length,
    overdueRfiCount,
    proposedChangeCount: proposed.length,
    proposedSellImpact: moneyToString(proposedSum),
    pendingChangeOrderCount: cos,
  };
}
