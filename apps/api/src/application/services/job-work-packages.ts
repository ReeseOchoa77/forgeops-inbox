import type { JobWorkPackageStatus, PrismaClient } from "@prisma/client";
import {
  decimalToNumber,
  lineEstimatedHours,
  presentFabricationItem,
} from "./job-fabrication.js";
import {
  listJobMilestones,
  nextMilestoneByPackage,
  type NextMilestoneDto,
} from "./job-milestones.js";

export const JOB_WORK_PACKAGE_STATUSES = [
  "NOT_STARTED",
  "DETAILING",
  "AWAITING_APPROVAL",
  "FIELD_MEASURE",
  "READY_FOR_FABRICATION",
  "FABRICATING",
  "READY_TO_SHIP",
  "DELIVERED",
  "INSTALLING",
  "COMPLETE",
  "ON_HOLD",
] as const satisfies readonly JobWorkPackageStatus[];

export const WORK_PACKAGE_STATUS_LABELS: Record<JobWorkPackageStatus, string> = {
  NOT_STARTED: "Not started",
  DETAILING: "Detailing",
  AWAITING_APPROVAL: "Awaiting approval",
  FIELD_MEASURE: "Field measure",
  READY_FOR_FABRICATION: "Ready for fabrication",
  FABRICATING: "Fabricating",
  READY_TO_SHIP: "Ready to ship",
  DELIVERED: "Delivered",
  INSTALLING: "Installing",
  COMPLETE: "Complete",
  ON_HOLD: "On hold",
};

export class JobWorkPackageError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "JobWorkPackageError";
  }
}

export type FabricationItemDto = ReturnType<typeof presentFabricationItem> & {
  workPackageId: string | null;
};

export type WorkPackageDto = {
  id: string;
  jobId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  status: JobWorkPackageStatus;
  statusLabel: string;
  sortOrder: number;
  notes: string | null;
  itemCount: number;
  totalQuantity: number;
  estimatedHours: number;
  childCount: number;
  nextMilestone: NextMilestoneDto | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkPackageSummary = {
  total: number;
  byStatus: Array<{ status: JobWorkPackageStatus; label: string; count: number }>;
  active: Array<{ id: string; name: string; status: JobWorkPackageStatus; statusLabel: string }>;
};

function presentItem(row: {
  id: string;
  name: string;
  quantity: { toString(): string } | number | string;
  estimatedHoursPerPiece: { toString(): string } | number | string;
  sortOrder: number;
  workPackageId: string | null;
}): FabricationItemDto {
  return {
    ...presentFabricationItem(row),
    workPackageId: row.workPackageId,
  };
}

export function buildWorkPackageDtos(
  packages: Array<{
    id: string;
    jobId: string;
    parentId: string | null;
    name: string;
    description: string | null;
    status: JobWorkPackageStatus;
    sortOrder: number;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>,
  items: Array<{
    workPackageId: string | null;
    quantity: { toString(): string } | number | string;
    estimatedHoursPerPiece: { toString(): string } | number | string;
  }>
): WorkPackageDto[] {
  const childCount = new Map<string, number>();
  for (const pkg of packages) {
    if (pkg.parentId) {
      childCount.set(pkg.parentId, (childCount.get(pkg.parentId) ?? 0) + 1);
    }
  }

  const itemAgg = new Map<string, { count: number; qty: number; hours: number }>();
  for (const item of items) {
    if (!item.workPackageId) continue;
    const qty = decimalToNumber(item.quantity);
    const hours = lineEstimatedHours(qty, decimalToNumber(item.estimatedHoursPerPiece));
    const prev = itemAgg.get(item.workPackageId) ?? { count: 0, qty: 0, hours: 0 };
    itemAgg.set(item.workPackageId, {
      count: prev.count + 1,
      qty: prev.qty + qty,
      hours: prev.hours + hours,
    });
  }

  return packages.map((pkg) => {
    const agg = itemAgg.get(pkg.id) ?? { count: 0, qty: 0, hours: 0 };
    return {
      id: pkg.id,
      jobId: pkg.jobId,
      parentId: pkg.parentId,
      name: pkg.name,
      description: pkg.description,
      status: pkg.status,
      statusLabel: WORK_PACKAGE_STATUS_LABELS[pkg.status],
      sortOrder: pkg.sortOrder,
      notes: pkg.notes,
      itemCount: agg.count,
      totalQuantity: Math.round(agg.qty * 100) / 100,
      estimatedHours: Math.round(agg.hours * 100) / 100,
      childCount: childCount.get(pkg.id) ?? 0,
      nextMilestone: null,
      createdAt: pkg.createdAt.toISOString(),
      updatedAt: pkg.updatedAt.toISOString(),
    };
  });
}

export function buildWorkPackageSummary(packages: WorkPackageDto[]): WorkPackageSummary {
  const counts = new Map<JobWorkPackageStatus, number>();
  for (const pkg of packages) {
    counts.set(pkg.status, (counts.get(pkg.status) ?? 0) + 1);
  }
  const byStatus = JOB_WORK_PACKAGE_STATUSES.filter((s) => (counts.get(s) ?? 0) > 0).map((status) => ({
    status,
    label: WORK_PACKAGE_STATUS_LABELS[status],
    count: counts.get(status) ?? 0,
  }));

  const activeStatuses = new Set<JobWorkPackageStatus>([
    "DETAILING",
    "AWAITING_APPROVAL",
    "FIELD_MEASURE",
    "READY_FOR_FABRICATION",
    "FABRICATING",
    "READY_TO_SHIP",
    "DELIVERED",
    "INSTALLING",
    "ON_HOLD",
  ]);
  const active = packages
    .filter((p) => activeStatuses.has(p.status))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      statusLabel: p.statusLabel,
    }));

  return { total: packages.length, byStatus, active };
}

export async function loadJobScope(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string }
): Promise<{
  packages: WorkPackageDto[];
  items: FabricationItemDto[];
  unassignedItems: FabricationItemDto[];
  estimatedHours: number;
  summary: WorkPackageSummary;
}> {
  const [packages, itemRows, milestones] = await Promise.all([
    prisma.jobWorkPackage.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.jobFabricationItem.findMany({
      where: { workspaceId: input.workspaceId, jobId: input.jobId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    listJobMilestones(prisma, input),
  ]);

  const items = itemRows.map(presentItem);
  const packageDtos = buildWorkPackageDtos(packages, itemRows);
  const nextByPkg = nextMilestoneByPackage(milestones);
  for (const pkg of packageDtos) {
    pkg.nextMilestone = nextByPkg.get(pkg.id) ?? null;
  }
  const estimatedHours = items.reduce((sum, item) => sum + item.totalHours, 0);

  return {
    packages: packageDtos,
    items,
    unassignedItems: items.filter((i) => i.workPackageId == null),
    estimatedHours: Math.round(estimatedHours * 100) / 100,
    summary: buildWorkPackageSummary(packageDtos),
  };
}

export async function createWorkPackage(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    name: string;
    description?: string | null;
    status?: JobWorkPackageStatus;
    parentId?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
): Promise<WorkPackageDto> {
  const name = input.name.trim();
  if (!name) throw new JobWorkPackageError("Name is required", 400);

  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) throw new JobWorkPackageError("Job not found", 404);

  if (input.parentId) {
    const parent = await prisma.jobWorkPackage.findFirst({
      where: {
        id: input.parentId,
        workspaceId: input.workspaceId,
        jobId: input.jobId,
      },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new JobWorkPackageError("Parent work package not found on this job", 404);
    if (parent.parentId) {
      throw new JobWorkPackageError("Only one level of package hierarchy is supported", 400);
    }
  }

  const last = await prisma.jobWorkPackage.findFirst({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.jobWorkPackage.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        name,
        description: input.description?.trim() || null,
        status: input.status ?? "NOT_STARTED",
        parentId: input.parentId ?? null,
        notes: input.notes?.trim() || null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "WORK_PACKAGE_CREATED",
        entityType: "JOB_WORK_PACKAGE",
        entityId: row.id,
        actorUserId: input.actorUserId,
        newValue: { name: row.name, status: row.status, parentId: row.parentId },
      },
    });
    return row;
  });

  return buildWorkPackageDtos([created], [])[0]!;
}

export async function updateWorkPackage(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    packageId: string;
    name?: string;
    description?: string | null;
    status?: JobWorkPackageStatus;
    parentId?: string | null;
    notes?: string | null;
    sortOrder?: number;
    actorUserId: string;
  }
): Promise<WorkPackageDto> {
  const existing = await prisma.jobWorkPackage.findFirst({
    where: {
      id: input.packageId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
  });
  if (!existing) throw new JobWorkPackageError("Work package not found", 404);

  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === input.packageId) {
      throw new JobWorkPackageError("A work package cannot be its own parent", 400);
    }
    const parent = await prisma.jobWorkPackage.findFirst({
      where: {
        id: input.parentId,
        workspaceId: input.workspaceId,
        jobId: input.jobId,
      },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new JobWorkPackageError("Parent work package not found on this job", 404);
    if (parent.parentId) {
      throw new JobWorkPackageError("Only one level of package hierarchy is supported", 400);
    }
    const childCount = await prisma.jobWorkPackage.count({
      where: { parentId: input.packageId, workspaceId: input.workspaceId, jobId: input.jobId },
    });
    if (childCount > 0) {
      throw new JobWorkPackageError("Move or remove child packages before nesting this package", 400);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.jobWorkPackage.update({
      where: { id: input.packageId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "WORK_PACKAGE_UPDATED",
        entityType: "JOB_WORK_PACKAGE",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: {
          name: existing.name,
          status: existing.status,
          parentId: existing.parentId,
        },
        newValue: {
          name: row.name,
          status: row.status,
          parentId: row.parentId,
        },
      },
    });
    return row;
  });

  const items = await prisma.jobFabricationItem.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId, workPackageId: updated.id },
    select: { workPackageId: true, quantity: true, estimatedHoursPerPiece: true },
  });
  const children = await prisma.jobWorkPackage.count({
    where: { parentId: updated.id, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  const dto = buildWorkPackageDtos([updated], items)[0]!;
  return { ...dto, childCount: children };
}

export async function deleteWorkPackage(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    packageId: string;
    actorUserId: string;
  }
): Promise<void> {
  const existing = await prisma.jobWorkPackage.findFirst({
    where: {
      id: input.packageId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
    select: { id: true, name: true, status: true },
  });
  if (!existing) throw new JobWorkPackageError("Work package not found", 404);

  const childCount = await prisma.jobWorkPackage.count({
    where: { parentId: input.packageId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (childCount > 0) {
    throw new JobWorkPackageError(
      "Move or delete child work packages before deleting this package",
      409
    );
  }

  const milestoneCount = await prisma.jobMilestone.count({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      workPackageId: input.packageId,
    },
  });
  if (milestoneCount > 0) {
    throw new JobWorkPackageError(
      "Delete or reassign milestones on this package before deleting it",
      409
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.jobFabricationItem.updateMany({
      where: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        workPackageId: input.packageId,
      },
      data: { workPackageId: null },
    });
    await tx.jobWorkPackage.delete({ where: { id: input.packageId } });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "WORK_PACKAGE_DELETED",
        entityType: "JOB_WORK_PACKAGE",
        entityId: existing.id,
        actorUserId: input.actorUserId,
        previousValue: { name: existing.name, status: existing.status },
      },
    });
  });
}

export async function assignFabricationItemPackage(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    itemId: string;
    workPackageId: string | null;
    actorUserId: string;
  }
): Promise<FabricationItemDto> {
  const item = await prisma.jobFabricationItem.findFirst({
    where: { id: input.itemId, workspaceId: input.workspaceId, jobId: input.jobId },
  });
  if (!item) throw new JobWorkPackageError("Fabrication item not found", 404);

  if (input.workPackageId) {
    const pkg = await prisma.jobWorkPackage.findFirst({
      where: {
        id: input.workPackageId,
        workspaceId: input.workspaceId,
        jobId: input.jobId,
      },
      select: { id: true },
    });
    if (!pkg) {
      throw new JobWorkPackageError("Work package not found on this job", 404);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.jobFabricationItem.update({
      where: { id: item.id },
      data: { workPackageId: input.workPackageId },
    });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "FABRICATION_ITEM_MOVED",
        entityType: "JOB_FABRICATION_ITEM",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: { workPackageId: item.workPackageId },
        newValue: { workPackageId: row.workPackageId },
      },
    });
    return row;
  });

  return presentItem(updated);
}

export async function reorderWorkPackages(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    orderedIds: string[];
    actorUserId: string;
  }
): Promise<WorkPackageDto[]> {
  const existing = await prisma.jobWorkPackage.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((p) => p.id));
  if (
    input.orderedIds.length !== existingIds.size ||
    input.orderedIds.some((id) => !existingIds.has(id))
  ) {
    throw new JobWorkPackageError("orderedIds must include every work package on this job", 400);
  }

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < input.orderedIds.length; index += 1) {
      await tx.jobWorkPackage.update({
        where: { id: input.orderedIds[index]! },
        data: { sortOrder: index },
      });
    }
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "WORK_PACKAGE_UPDATED",
        entityType: "JOB_WORK_PACKAGE",
        entityId: input.jobId,
        actorUserId: input.actorUserId,
        newValue: { op: "reorder", count: input.orderedIds.length },
      },
    });
  });

  const scope = await loadJobScope(prisma, input);
  return scope.packages;
}
