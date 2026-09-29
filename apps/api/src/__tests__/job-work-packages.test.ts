import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  assignFabricationItemPackage,
  buildWorkPackageDtos,
  buildWorkPackageSummary,
  createWorkPackage,
  deleteWorkPackage,
  JOB_WORK_PACKAGE_STATUSES,
  JobWorkPackageError,
  loadJobScope,
  updateWorkPackage,
  WORK_PACKAGE_STATUS_LABELS,
} from "../application/services/job-work-packages.js";
import { presentFabricationItem, totalEstimatedHours } from "../application/services/job-fabrication.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("job work packages", () => {
  it("exposes the Phase B operational status set with human labels", () => {
    expect(JOB_WORK_PACKAGE_STATUSES).toEqual([
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
    ]);
    expect(WORK_PACKAGE_STATUS_LABELS.READY_FOR_FABRICATION).toBe("Ready for fabrication");
    expect(WORK_PACKAGE_STATUS_LABELS.ON_HOLD).toBe("On hold");
  });

  it("aggregates package item counts and estimated hours without storing totals", () => {
    const packages = [
      {
        id: "pkg-a",
        jobId: "job-1",
        parentId: null,
        name: "Structural Steel",
        description: null,
        status: "FABRICATING" as const,
        sortOrder: 0,
        notes: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
      {
        id: "pkg-b",
        jobId: "job-1",
        parentId: "pkg-a",
        name: "Area A",
        description: null,
        status: "DETAILING" as const,
        sortOrder: 1,
        notes: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];
    const items = [
      { workPackageId: "pkg-a", quantity: 12, estimatedHoursPerPiece: 2.5 },
      { workPackageId: "pkg-a", quantity: 8, estimatedHoursPerPiece: 3 },
      { workPackageId: "pkg-b", quantity: 1, estimatedHoursPerPiece: 20 },
      { workPackageId: null, quantity: 4, estimatedHoursPerPiece: 1 },
    ];
    const dtos = buildWorkPackageDtos(packages, items);
    expect(dtos[0]).toMatchObject({
      id: "pkg-a",
      itemCount: 2,
      totalQuantity: 20,
      estimatedHours: 54,
      childCount: 1,
      statusLabel: "Fabricating",
    });
    expect(dtos[1]).toMatchObject({
      id: "pkg-b",
      itemCount: 1,
      estimatedHours: 20,
      childCount: 0,
    });
    expect(totalEstimatedHours(items.map((i) => ({
      quantity: Number(i.quantity),
      estimatedHoursPerPiece: Number(i.estimatedHoursPerPiece),
    })))).toBe(78);
  });

  it("builds a compact overview summary from package statuses", () => {
    const summary = buildWorkPackageSummary([
      {
        id: "1",
        jobId: "j",
        parentId: null,
        name: "Stair A",
        description: null,
        status: "FABRICATING",
        statusLabel: "Fabricating",
        sortOrder: 0,
        notes: null,
        itemCount: 1,
        totalQuantity: 1,
        estimatedHours: 20,
        childCount: 0,
        nextMilestone: null,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "2",
        jobId: "j",
        parentId: null,
        name: "Rails",
        description: null,
        status: "AWAITING_APPROVAL",
        statusLabel: "Awaiting approval",
        sortOrder: 1,
        notes: null,
        itemCount: 1,
        totalQuantity: 80,
        estimatedHours: 40,
        childCount: 0,
        nextMilestone: null,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "3",
        jobId: "j",
        parentId: null,
        name: "Done",
        description: null,
        status: "COMPLETE",
        statusLabel: "Complete",
        sortOrder: 2,
        notes: null,
        itemCount: 0,
        totalQuantity: 0,
        estimatedHours: 0,
        childCount: 0,
        nextMilestone: null,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byStatus).toEqual([
      { status: "AWAITING_APPROVAL", label: "Awaiting approval", count: 1 },
      { status: "FABRICATING", label: "Fabricating", count: 1 },
      { status: "COMPLETE", label: "Complete", count: 1 },
    ]);
    expect(summary.active.map((a) => a.name)).toEqual(["Stair A", "Rails"]);
  });

  it("rejects empty package names and missing jobs on create", async () => {
    await expect(
      createWorkPackage({} as never, {
        workspaceId: "ws",
        jobId: "job",
        name: "   ",
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      createWorkPackage(prisma as never, {
        workspaceId: "ws",
        jobId: "missing",
        name: "Area A",
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects cross-job parents and deeper than one hierarchy level", async () => {
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobWorkPackage: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "parent", parentId: "grand" }),
      },
    };
    await expect(
      createWorkPackage(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        name: "Child",
        parentId: "other-job-pkg",
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({ message: "Parent work package not found on this job", statusCode: 404 });

    await expect(
      createWorkPackage(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        name: "Too deep",
        parentId: "parent",
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates a package with activity and default NOT_STARTED", async () => {
    const created = {
      id: "pkg-1",
      workspaceId: "ws",
      jobId: "job-1",
      parentId: null,
      name: "Rails",
      description: null,
      status: "NOT_STARTED" as const,
      sortOrder: 0,
      notes: null,
      createdAt: new Date("2026-01-02"),
      updatedAt: new Date("2026-01-02"),
    };
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobWorkPackage: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      jobActivityLog: { create: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobWorkPackage: { create: vi.fn().mockResolvedValue(created) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await createWorkPackage(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      name: "Rails",
      actorUserId: "u1",
    });
    expect(dto).toMatchObject({
      id: "pkg-1",
      name: "Rails",
      status: "NOT_STARTED",
      itemCount: 0,
      estimatedHours: 0,
    });
  });

  it("changes status and renames through updateWorkPackage", async () => {
    const existing = {
      id: "pkg-1",
      workspaceId: "ws",
      jobId: "job-1",
      parentId: null,
      name: "Rails",
      description: null,
      status: "NOT_STARTED" as const,
      sortOrder: 0,
      notes: null,
      createdAt: new Date("2026-01-02"),
      updatedAt: new Date("2026-01-02"),
    };
    const updated = { ...existing, name: "Handrails", status: "FABRICATING" as const };
    const prisma = {
      jobWorkPackage: {
        findFirst: vi.fn().mockResolvedValue(existing),
        count: vi.fn().mockResolvedValue(0),
      },
      jobFabricationItem: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobWorkPackage: { update: vi.fn().mockResolvedValue(updated) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await updateWorkPackage(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      packageId: "pkg-1",
      name: "Handrails",
      status: "FABRICATING",
      actorUserId: "u1",
    });
    expect(dto).toMatchObject({ name: "Handrails", status: "FABRICATING", statusLabel: "Fabricating" });
  });

  it("prevents deleting a parent that still has children", async () => {
    const prisma = {
      jobWorkPackage: {
        findFirst: vi.fn().mockResolvedValue({ id: "pkg-1", name: "Structural", status: "DETAILING" }),
        count: vi.fn().mockResolvedValue(2),
      },
    };
    await expect(
      deleteWorkPackage(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        packageId: "pkg-1",
        actorUserId: "u1",
      })
    ).rejects.toBeInstanceOf(JobWorkPackageError);
  });

  it("prevents deleting a package that still has milestones", async () => {
    const prisma = {
      jobWorkPackage: {
        findFirst: vi.fn().mockResolvedValue({ id: "pkg-1", name: "Rails", status: "DETAILING" }),
        count: vi.fn().mockResolvedValue(0),
      },
      jobMilestone: {
        count: vi.fn().mockResolvedValue(2),
      },
    };
    await expect(
      deleteWorkPackage(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        packageId: "pkg-1",
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({
      message: "Delete or reassign milestones on this package before deleting it",
      statusCode: 409,
    });
  });

  it("unassigns fabrication items before deleting a package", async () => {
    const updateMany = vi.fn();
    const del = vi.fn();
    const activity = vi.fn();
    const prisma = {
      jobWorkPackage: {
        findFirst: vi.fn().mockResolvedValue({ id: "pkg-1", name: "Rails", status: "DETAILING" }),
        count: vi.fn().mockResolvedValue(0),
      },
      jobMilestone: {
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobFabricationItem: { updateMany },
          jobWorkPackage: { delete: del },
          jobActivityLog: { create: activity },
        })
      ),
    };
    await deleteWorkPackage(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      packageId: "pkg-1",
      actorUserId: "u1",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws", jobId: "job-1", workPackageId: "pkg-1" },
      data: { workPackageId: null },
    });
    expect(del).toHaveBeenCalledWith({ where: { id: "pkg-1" } });
    expect(activity).toHaveBeenCalled();
  });

  it("rejects assigning a fabrication item to a package on another job", async () => {
    const prisma = {
      jobFabricationItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          workspaceId: "ws",
          jobId: "job-1",
          workPackageId: null,
          name: "Beams",
          quantity: 10,
          estimatedHoursPerPiece: 2,
          sortOrder: 0,
        }),
      },
      jobWorkPackage: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    await expect(
      assignFabricationItemPackage(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        itemId: "item-1",
        workPackageId: "pkg-other-job",
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({ message: "Work package not found on this job", statusCode: 404 });
  });

  it("assigns and unassigns fabrication items with activity", async () => {
    const item = {
      id: "item-1",
      workspaceId: "ws",
      jobId: "job-1",
      workPackageId: null,
      name: "Beams",
      quantity: "12.00",
      estimatedHoursPerPiece: "2.50",
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updated = { ...item, workPackageId: "pkg-1" };
    const prisma = {
      jobFabricationItem: { findFirst: vi.fn().mockResolvedValue(item) },
      jobWorkPackage: { findFirst: vi.fn().mockResolvedValue({ id: "pkg-1" }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobFabricationItem: { update: vi.fn().mockResolvedValue(updated) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await assignFabricationItemPackage(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      itemId: "item-1",
      workPackageId: "pkg-1",
      actorUserId: "u1",
    });
    expect(dto).toMatchObject({ id: "item-1", workPackageId: "pkg-1", totalHours: 30 });
  });

  it("loads scope with unassigned items and package aggregates", async () => {
    const prisma = {
      jobWorkPackage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "pkg-1",
            jobId: "job-1",
            parentId: null,
            name: "Misc",
            description: null,
            status: "DETAILING",
            sortOrder: 0,
            notes: null,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
          },
        ]),
      },
      jobFabricationItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "i1",
            name: "Rails",
            quantity: 80,
            estimatedHoursPerPiece: 0.5,
            sortOrder: 0,
            workPackageId: "pkg-1",
          },
          {
            id: "i2",
            name: "Ladder",
            quantity: 1,
            estimatedHoursPerPiece: 8,
            sortOrder: 1,
            workPackageId: null,
          },
        ]),
      },
      jobMilestone: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const scope = await loadJobScope(prisma as never, { workspaceId: "ws", jobId: "job-1" });
    expect(scope.packages[0]).toMatchObject({ itemCount: 1, estimatedHours: 40, nextMilestone: null });
    expect(scope.unassignedItems).toHaveLength(1);
    expect(scope.unassignedItems[0]?.name).toBe("Ladder");
    expect(scope.estimatedHours).toBe(48);
    expect(scope.summary.total).toBe(1);
  });

  it("keeps presentation including nullable workPackageId for unassigned items", () => {
    expect(
      presentFabricationItem({
        id: "item-1",
        name: "Ladder",
        quantity: 1,
        estimatedHoursPerPiece: 8,
        sortOrder: 0,
      })
    ).toMatchObject({ workPackageId: null, totalHours: 8 });
  });

  it("wires Scope tab, overview summary, and routes without AI or job-list hydration", () => {
    const detail = readFileSync(resolve(here, "../../../web/src/views/JobDetailView.tsx"), "utf8");
    expect(detail).toContain("key: 'scope'");
    expect(detail).toContain("<JobScopeView");
    expect(detail).toContain("<WorkPackageOverviewSummary");
    expect(detail).not.toContain("<JobFabricationScope");

    const scope = readFileSync(resolve(here, "../../../web/src/views/JobScopeView.tsx"), "utf8");
    expect(scope).toContain("+ Work Package");
    expect(scope).toContain("Unassigned");
    expect(scope).toContain("Ready for fabrication");
    expect(scope).toContain("assignFabricationItemWorkPackage");

    const route = readFileSync(
      resolve(here, "../interfaces/http/routes/job-work-packages.route.ts"),
      "utf8"
    );
    expect(route).toContain("/scope");
    expect(route).toContain("/work-packages");
    expect(route).toContain("canEditJob");
    expect(route).not.toContain("INLINE_IMAGE");
    expect(route).not.toContain("JOB_MATCHER");

    const listRoute = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    const listHandler = listRoute.slice(
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs — List jobs"),
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs/:jobId — Job detail")
    );
    expect(listHandler).not.toContain("jobWorkPackage");
    expect(listHandler).not.toContain("workPackage");

    const migration = readFileSync(
      resolve(here, "../../../../packages/db/prisma/migrations/20260929220000_job_work_packages/migration.sql"),
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE "JobWorkPackage"');
    expect(migration).toContain('ADD COLUMN "workPackageId" TEXT');
    expect(migration).toContain("ON DELETE SET NULL");
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).not.toContain("targetDate");
  });
});
