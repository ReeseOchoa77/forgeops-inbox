import type { JobMilestoneStatus, JobMilestoneType, PrismaClient } from "@prisma/client";
import { safeDateOrNull } from "@forgeops/shared";

export const JOB_MILESTONE_TYPES = [
  "GENERAL",
  "SHOP_DRAWINGS",
  "SUBMITTAL",
  "APPROVAL",
  "FIELD_MEASURE",
  "MATERIAL_REQUIRED",
  "MATERIAL_ORDERED",
  "MATERIAL_EXPECTED",
  "FABRICATION_START",
  "FABRICATION_COMPLETE",
  "READY_TO_SHIP",
  "DELIVERY",
  "INSTALLATION_START",
  "INSTALLATION_COMPLETE",
  "PROJECT_COMPLETE",
] as const satisfies readonly JobMilestoneType[];

export const JOB_MILESTONE_STATUSES = [
  "OPEN",
  "COMPLETE",
  "CANCELLED",
] as const satisfies readonly JobMilestoneStatus[];

export const MILESTONE_TYPE_LABELS: Record<JobMilestoneType, string> = {
  GENERAL: "General",
  SHOP_DRAWINGS: "Shop drawings",
  SUBMITTAL: "Submittal",
  APPROVAL: "Approval",
  FIELD_MEASURE: "Field measure",
  MATERIAL_REQUIRED: "Material required",
  MATERIAL_ORDERED: "Material ordered",
  MATERIAL_EXPECTED: "Material expected",
  FABRICATION_START: "Fabrication start",
  FABRICATION_COMPLETE: "Fabrication complete",
  READY_TO_SHIP: "Ready to ship",
  DELIVERY: "Delivery",
  INSTALLATION_START: "Installation start",
  INSTALLATION_COMPLETE: "Installation complete",
  PROJECT_COMPLETE: "Project complete",
};

export class JobMilestoneError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "JobMilestoneError";
  }
}

/** UTC calendar day YYYY-MM-DD from a DateTime stored as UTC midnight. */
export function toUtcDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Normalize API date input to UTC midnight DateTime (date-only semantics). */
export function normalizeMilestoneDate(raw: unknown): Date | null {
  if (raw === null) return null;
  if (raw === undefined) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const parsed = safeDateOrNull(raw);
  if (!parsed) {
    throw new JobMilestoneError("Invalid date", 400);
  }
  const ymd = toUtcDateOnly(parsed);
  if (!ymd) throw new JobMilestoneError("Invalid date", 400);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function utcTodayYmd(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isMilestoneOverdue(
  status: JobMilestoneStatus,
  plannedDate: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (status !== "OPEN") return false;
  const planned = toUtcDateOnly(plannedDate);
  if (!planned) return false;
  return planned < utcTodayYmd(now);
}

export function daysOverdue(
  plannedDate: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  const planned = toUtcDateOnly(plannedDate);
  if (!planned) return null;
  const today = utcTodayYmd(now);
  if (planned >= today) return null;
  const a = Date.parse(`${planned}T00:00:00.000Z`);
  const b = Date.parse(`${today}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

export type MilestoneDto = {
  id: string;
  jobId: string;
  workPackageId: string | null;
  workPackageName: string | null;
  type: JobMilestoneType;
  typeLabel: string;
  name: string;
  plannedDate: string | null;
  actualDate: string | null;
  status: JobMilestoneStatus;
  overdue: boolean;
  daysOverdue: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NextMilestoneDto = {
  id: string;
  name: string;
  type: JobMilestoneType;
  typeLabel: string;
  plannedDate: string | null;
  overdue: boolean;
};

export type ScheduleSummary = {
  upcoming: Array<{
    id: string;
    name: string;
    typeLabel: string;
    plannedDate: string;
    workPackageName: string | null;
  }>;
  overdue: Array<{
    id: string;
    name: string;
    typeLabel: string;
    plannedDate: string;
    workPackageName: string | null;
    daysOverdue: number;
  }>;
  upcomingCount: number;
  overdueCount: number;
  undatedOpenCount: number;
};

type MilestoneRow = {
  id: string;
  jobId: string;
  workPackageId: string | null;
  type: JobMilestoneType;
  name: string;
  plannedDate: Date | null;
  actualDate: Date | null;
  status: JobMilestoneStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  workPackage?: { id: string; name: string } | null;
};

export function defaultMilestoneName(type: JobMilestoneType, name?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return MILESTONE_TYPE_LABELS[type];
}

export function presentMilestone(row: MilestoneRow, now: Date = new Date()): MilestoneDto {
  const overdue = isMilestoneOverdue(row.status, row.plannedDate, now);
  return {
    id: row.id,
    jobId: row.jobId,
    workPackageId: row.workPackageId,
    workPackageName: row.workPackage?.name ?? null,
    type: row.type,
    typeLabel: MILESTONE_TYPE_LABELS[row.type],
    name: row.name,
    plannedDate: toUtcDateOnly(row.plannedDate),
    actualDate: toUtcDateOnly(row.actualDate),
    status: row.status,
    overdue,
    daysOverdue: overdue ? daysOverdue(row.plannedDate, now) : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Sort: dated ascending, then undated, then by name/id. Completed/cancelled callers filter separately. */
export function compareMilestonesByDate(
  a: { plannedDate: string | null; name: string; id: string },
  b: { plannedDate: string | null; name: string; id: string }
): number {
  if (a.plannedDate && b.plannedDate) {
    if (a.plannedDate !== b.plannedDate) return a.plannedDate < b.plannedDate ? -1 : 1;
  } else if (a.plannedDate && !b.plannedDate) return -1;
  else if (!a.plannedDate && b.plannedDate) return 1;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

export function buildScheduleSummary(
  milestones: MilestoneDto[],
  opts: { upcomingLimit?: number; overdueLimit?: number } = {}
): ScheduleSummary {
  const upcomingLimit = opts.upcomingLimit ?? 5;
  const overdueLimit = opts.overdueLimit ?? 5;
  const open = milestones.filter((m) => m.status === "OPEN");
  const overdue = open
    .filter((m) => m.overdue && m.plannedDate)
    .sort(compareMilestonesByDate)
    .map((m) => ({
      id: m.id,
      name: m.name,
      typeLabel: m.typeLabel,
      plannedDate: m.plannedDate!,
      workPackageName: m.workPackageName,
      daysOverdue: m.daysOverdue ?? 0,
    }));
  const upcoming = open
    .filter((m) => m.plannedDate && !m.overdue)
    .sort(compareMilestonesByDate)
    .map((m) => ({
      id: m.id,
      name: m.name,
      typeLabel: m.typeLabel,
      plannedDate: m.plannedDate!,
      workPackageName: m.workPackageName,
    }));
  const undatedOpenCount = open.filter((m) => !m.plannedDate).length;
  return {
    upcoming: upcoming.slice(0, upcomingLimit),
    overdue: overdue.slice(0, overdueLimit),
    upcomingCount: upcoming.length,
    overdueCount: overdue.length,
    undatedOpenCount,
  };
}

/** Earliest open milestone per package (overdue preferred, then dated ascending, then undated). */
export function nextMilestoneByPackage(
  milestones: MilestoneDto[]
): Map<string, NextMilestoneDto> {
  const map = new Map<string, NextMilestoneDto>();
  const open = milestones.filter((m) => m.status === "OPEN" && m.workPackageId);
  const ranked = [...open].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return compareMilestonesByDate(a, b);
  });
  for (const m of ranked) {
    const pkgId = m.workPackageId!;
    if (map.has(pkgId)) continue;
    map.set(pkgId, {
      id: m.id,
      name: m.name,
      type: m.type,
      typeLabel: m.typeLabel,
      plannedDate: m.plannedDate,
      overdue: m.overdue,
    });
  }
  return map;
}

const includePackage = { workPackage: { select: { id: true, name: true } } } as const;

export async function listJobMilestones(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; now?: Date }
): Promise<MilestoneDto[]> {
  const rows = await prisma.jobMilestone.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: includePackage,
    orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
  });
  const now = input.now ?? new Date();
  return rows.map((r) => presentMilestone(r, now)).sort(compareMilestonesByDate);
}

export async function buildJobScheduleSummary(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; now?: Date }
): Promise<ScheduleSummary> {
  const milestones = await listJobMilestones(prisma, input);
  return buildScheduleSummary(milestones);
}

async function assertSameJobPackage(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; workPackageId: string }
): Promise<void> {
  const pkg = await prisma.jobWorkPackage.findFirst({
    where: {
      id: input.workPackageId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
    select: { id: true },
  });
  if (!pkg) {
    throw new JobMilestoneError("Work package not found on this job", 404);
  }
}

export async function createMilestone(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    type?: JobMilestoneType;
    name?: string | null;
    plannedDate?: string | null;
    workPackageId?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
): Promise<MilestoneDto> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) throw new JobMilestoneError("Job not found", 404);

  const type = input.type ?? "GENERAL";
  const name = defaultMilestoneName(type, input.name);
  if (!name) throw new JobMilestoneError("Name is required", 400);

  if (input.workPackageId) {
    await assertSameJobPackage(prisma, {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      workPackageId: input.workPackageId,
    });
  }

  const plannedDate =
    input.plannedDate === undefined ? null : normalizeMilestoneDate(input.plannedDate);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobMilestone.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        workPackageId: input.workPackageId ?? null,
        type,
        name,
        plannedDate,
        notes: input.notes?.trim() || null,
        status: "OPEN",
      },
      include: includePackage,
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "MILESTONE_CREATED",
        entityType: "JOB_MILESTONE",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: {
          name: row.name,
          type: row.type,
          plannedDate: toUtcDateOnly(row.plannedDate),
          workPackageId: row.workPackageId,
        },
      },
    });
    return row;
  });

  return presentMilestone(created);
}

export async function updateMilestone(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    milestoneId: string;
    type?: JobMilestoneType;
    name?: string;
    plannedDate?: string | null;
    actualDate?: string | null;
    workPackageId?: string | null;
    notes?: string | null;
    status?: JobMilestoneStatus;
    actorUserId: string;
  }
): Promise<MilestoneDto> {
  const existing = await prisma.jobMilestone.findFirst({
    where: {
      id: input.milestoneId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
    include: includePackage,
  });
  if (!existing) throw new JobMilestoneError("Milestone not found", 404);

  if (input.workPackageId) {
    await assertSameJobPackage(prisma, {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      workPackageId: input.workPackageId,
    });
  }

  let nextStatus = input.status ?? existing.status;
  let nextActual =
    input.actualDate !== undefined
      ? normalizeMilestoneDate(input.actualDate)
      : existing.actualDate;

  // Status transitions with clear actualDate semantics
  if (input.status === "COMPLETE" && existing.status !== "COMPLETE") {
    nextStatus = "COMPLETE";
    if (input.actualDate === undefined) {
      nextActual = normalizeMilestoneDate(utcTodayYmd());
    }
  } else if (input.status === "OPEN" && existing.status !== "OPEN") {
    nextStatus = "OPEN";
    // Reopen clears actualDate unless caller explicitly sets one
    if (input.actualDate === undefined) {
      nextActual = null;
    }
  } else if (input.status === "CANCELLED") {
    nextStatus = "CANCELLED";
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.jobMilestone.update({
      where: { id: existing.id },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() || defaultMilestoneName(input.type ?? existing.type) } : {}),
        ...(input.plannedDate !== undefined
          ? { plannedDate: normalizeMilestoneDate(input.plannedDate) }
          : {}),
        ...(input.workPackageId !== undefined ? { workPackageId: input.workPackageId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        status: nextStatus,
        actualDate: nextActual,
      },
      include: includePackage,
    });

    let action: "MILESTONE_UPDATED" | "MILESTONE_COMPLETED" | "MILESTONE_REOPENED" | "MILESTONE_CANCELLED" =
      "MILESTONE_UPDATED";
    if (existing.status !== nextStatus) {
      if (nextStatus === "COMPLETE") action = "MILESTONE_COMPLETED";
      else if (nextStatus === "OPEN") action = "MILESTONE_REOPENED";
      else if (nextStatus === "CANCELLED") action = "MILESTONE_CANCELLED";
    }

    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action,
        entityType: "JOB_MILESTONE",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: {
          name: existing.name,
          plannedDate: toUtcDateOnly(existing.plannedDate),
          actualDate: toUtcDateOnly(existing.actualDate),
          status: existing.status,
        },
        newValue: {
          name: row.name,
          plannedDate: toUtcDateOnly(row.plannedDate),
          actualDate: toUtcDateOnly(row.actualDate),
          status: row.status,
        },
      },
    });
    return row;
  });

  return presentMilestone(updated);
}

export async function deleteMilestone(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    milestoneId: string;
    actorUserId: string;
  }
): Promise<void> {
  const existing = await prisma.jobMilestone.findFirst({
    where: {
      id: input.milestoneId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
    select: { id: true, name: true, status: true, plannedDate: true },
  });
  if (!existing) throw new JobMilestoneError("Milestone not found", 404);

  await prisma.$transaction(async (tx) => {
    await tx.jobMilestone.delete({ where: { id: existing.id } });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "MILESTONE_DELETED",
        entityType: "JOB_MILESTONE",
        entityId: existing.id,
        actorUserId: input.actorUserId,
        previousValue: {
          name: existing.name,
          status: existing.status,
          plannedDate: toUtcDateOnly(existing.plannedDate),
        },
      },
    });
  });
}

export async function countPackageMilestones(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string; packageId: string }
): Promise<number> {
  return prisma.jobMilestone.count({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      workPackageId: input.packageId,
    },
  });
}
