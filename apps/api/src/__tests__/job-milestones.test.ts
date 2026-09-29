import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildScheduleSummary,
  compareMilestonesByDate,
  createMilestone,
  daysOverdue,
  defaultMilestoneName,
  isMilestoneOverdue,
  JobMilestoneError,
  listJobMilestones,
  nextMilestoneByPackage,
  normalizeMilestoneDate,
  presentMilestone,
  toUtcDateOnly,
  updateMilestone,
  utcTodayYmd,
} from "../application/services/job-milestones.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixedNow = new Date("2026-10-12T15:00:00.000Z");

describe("job milestones", () => {
  it("stores and presents date-only values as UTC calendar days", () => {
    expect(normalizeMilestoneDate("2026-10-15")?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(toUtcDateOnly(new Date("2026-10-15T00:00:00.000Z"))).toBe("2026-10-15");
    expect(utcTodayYmd(fixedNow)).toBe("2026-10-12");
    expect(() => normalizeMilestoneDate("not-a-date")).toThrow(JobMilestoneError);
  });

  it("derives overdue from OPEN + plannedDate < today without persisting OVERDUE", () => {
    expect(isMilestoneOverdue("OPEN", "2026-10-10", fixedNow)).toBe(true);
    expect(isMilestoneOverdue("OPEN", "2026-10-12", fixedNow)).toBe(false);
    expect(isMilestoneOverdue("OPEN", "2026-10-18", fixedNow)).toBe(false);
    expect(isMilestoneOverdue("COMPLETE", "2026-10-01", fixedNow)).toBe(false);
    expect(isMilestoneOverdue("CANCELLED", "2026-10-01", fixedNow)).toBe(false);
    expect(isMilestoneOverdue("OPEN", null, fixedNow)).toBe(false);
    expect(daysOverdue("2026-10-09", fixedNow)).toBe(3);
  });

  it("defaults typed milestone names and allows GENERAL custom names", () => {
    expect(defaultMilestoneName("FABRICATION_START")).toBe("Fabrication start");
    expect(defaultMilestoneName("GENERAL", "Crane available")).toBe("Crane available");
    expect(defaultMilestoneName("APPROVAL", "  ")).toBe("Approval");
  });

  it("sorts dated ascending then undated", () => {
    const rows = [
      { id: "3", name: "B", plannedDate: null },
      { id: "1", name: "A", plannedDate: "2026-10-18" },
      { id: "2", name: "C", plannedDate: "2026-10-07" },
    ].sort(compareMilestonesByDate);
    expect(rows.map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("builds overview upcoming/overdue summaries", () => {
    const milestones = [
      presentMilestone(
        {
          id: "1",
          jobId: "j",
          workPackageId: "p1",
          type: "FABRICATION_START",
          name: "Fabrication start",
          plannedDate: new Date("2026-10-07T00:00:00.000Z"),
          actualDate: null,
          status: "OPEN",
          notes: null,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          workPackage: { id: "p1", name: "Area A" },
        },
        fixedNow
      ),
      presentMilestone(
        {
          id: "2",
          jobId: "j",
          workPackageId: "p2",
          type: "FIELD_MEASURE",
          name: "Field measure",
          plannedDate: new Date("2026-10-15T00:00:00.000Z"),
          actualDate: null,
          status: "OPEN",
          notes: null,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          workPackage: { id: "p2", name: "Stair A" },
        },
        fixedNow
      ),
      presentMilestone(
        {
          id: "3",
          jobId: "j",
          workPackageId: null,
          type: "GENERAL",
          name: "Need architect",
          plannedDate: null,
          actualDate: null,
          status: "OPEN",
          notes: null,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          workPackage: null,
        },
        fixedNow
      ),
    ];
    const summary = buildScheduleSummary(milestones);
    expect(summary.overdueCount).toBe(1);
    expect(summary.overdue[0]).toMatchObject({
      name: "Fabrication start",
      workPackageName: "Area A",
      daysOverdue: 5,
    });
    expect(summary.upcomingCount).toBe(1);
    expect(summary.upcoming[0]?.name).toBe("Field measure");
    expect(summary.undatedOpenCount).toBe(1);
  });

  it("picks next milestone per package preferring overdue then earliest date", () => {
    const map = nextMilestoneByPackage([
      presentMilestone(
        {
          id: "a",
          jobId: "j",
          workPackageId: "p1",
          type: "DELIVERY",
          name: "Delivery",
          plannedDate: new Date("2026-10-20T00:00:00.000Z"),
          actualDate: null,
          status: "OPEN",
          notes: null,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          workPackage: { id: "p1", name: "Area A" },
        },
        fixedNow
      ),
      presentMilestone(
        {
          id: "b",
          jobId: "j",
          workPackageId: "p1",
          type: "APPROVAL",
          name: "Approval",
          plannedDate: new Date("2026-10-01T00:00:00.000Z"),
          actualDate: null,
          status: "OPEN",
          notes: null,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          workPackage: { id: "p1", name: "Area A" },
        },
        fixedNow
      ),
    ]);
    expect(map.get("p1")?.id).toBe("b");
    expect(map.get("p1")?.overdue).toBe(true);
  });

  it("rejects cross-job work package assignment on create", async () => {
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobWorkPackage: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      createMilestone(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        type: "FIELD_MEASURE",
        workPackageId: "pkg-other",
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({ message: "Work package not found on this job", statusCode: 404 });
  });

  it("creates a job-level milestone with activity", async () => {
    const created = {
      id: "m1",
      jobId: "job-1",
      workPackageId: null,
      type: "SHOP_DRAWINGS" as const,
      name: "Shop drawings",
      plannedDate: new Date("2026-10-15T00:00:00.000Z"),
      actualDate: null,
      status: "OPEN" as const,
      notes: null,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      workPackage: null,
    };
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobMilestone: { create: vi.fn().mockResolvedValue(created) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await createMilestone(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      type: "SHOP_DRAWINGS",
      plannedDate: "2026-10-15",
      actorUserId: "u1",
    });
    expect(dto).toMatchObject({
      name: "Shop drawings",
      plannedDate: "2026-10-15",
      status: "OPEN",
      overdue: false,
    });
  });

  it("completes with explicit actual date and preserves planned date", async () => {
    const existing = {
      id: "m1",
      workspaceId: "ws",
      jobId: "job-1",
      workPackageId: null,
      type: "DELIVERY" as const,
      name: "Delivery",
      plannedDate: new Date("2026-10-18T00:00:00.000Z"),
      actualDate: null,
      status: "OPEN" as const,
      notes: null,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      workPackage: null,
    };
    const updated = {
      ...existing,
      status: "COMPLETE" as const,
      actualDate: new Date("2026-10-21T00:00:00.000Z"),
    };
    const prisma = {
      jobMilestone: { findFirst: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobMilestone: { update: vi.fn().mockResolvedValue(updated) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await updateMilestone(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      milestoneId: "m1",
      status: "COMPLETE",
      actualDate: "2026-10-21",
      actorUserId: "u1",
    });
    expect(dto.plannedDate).toBe("2026-10-18");
    expect(dto.actualDate).toBe("2026-10-21");
    expect(dto.status).toBe("COMPLETE");
    expect(dto.overdue).toBe(false);
  });

  it("reopens by clearing actualDate", async () => {
    const existing = {
      id: "m1",
      workspaceId: "ws",
      jobId: "job-1",
      workPackageId: null,
      type: "DELIVERY" as const,
      name: "Delivery",
      plannedDate: new Date("2026-10-18T00:00:00.000Z"),
      actualDate: new Date("2026-10-21T00:00:00.000Z"),
      status: "COMPLETE" as const,
      notes: null,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      workPackage: null,
    };
    const update = vi.fn().mockResolvedValue({
      ...existing,
      status: "OPEN",
      actualDate: null,
    });
    const prisma = {
      jobMilestone: { findFirst: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobMilestone: { update },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await updateMilestone(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      milestoneId: "m1",
      status: "OPEN",
      actorUserId: "u1",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "OPEN", actualDate: null }),
      })
    );
    expect(dto.status).toBe("OPEN");
    expect(dto.actualDate).toBeNull();
  });

  it("lists milestones sorted for schedule view", async () => {
    const prisma = {
      jobMilestone: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "2",
            jobId: "job-1",
            workPackageId: null,
            type: "GENERAL",
            name: "Later",
            plannedDate: new Date("2026-11-01T00:00:00.000Z"),
            actualDate: null,
            status: "OPEN",
            notes: null,
            createdAt: fixedNow,
            updatedAt: fixedNow,
            workPackage: null,
          },
          {
            id: "1",
            jobId: "job-1",
            workPackageId: null,
            type: "GENERAL",
            name: "Soon",
            plannedDate: new Date("2026-10-14T00:00:00.000Z"),
            actualDate: null,
            status: "OPEN",
            notes: null,
            createdAt: fixedNow,
            updatedAt: fixedNow,
            workPackage: null,
          },
        ]),
      },
    };
    const list = await listJobMilestones(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      now: fixedNow,
    });
    expect(list.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("wires Schedule tab, package delete block, and no AI/calendar/task auto coupling", () => {
    const detail = readFileSync(resolve(here, "../../../web/src/views/JobDetailView.tsx"), "utf8");
    expect(detail).toContain("key: 'schedule'");
    expect(detail).toContain("<JobScheduleView");
    expect(detail).toContain("<ScheduleOverviewSummary");

    const schedule = readFileSync(resolve(here, "../../../web/src/views/JobScheduleView.tsx"), "utf8");
    expect(schedule).toContain("+ Milestone");
    expect(schedule).toContain("Overdue");
    expect(schedule).toContain("Date not set");
    expect(schedule).toContain("actualDate");

    const wp = readFileSync(resolve(here, "../application/services/job-work-packages.ts"), "utf8");
    expect(wp).toContain("Delete or reassign milestones on this package before deleting it");
    expect(wp).toContain("nextMilestone");
    expect(wp).not.toContain("status: \"FABRICATING\"");

    const ms = readFileSync(resolve(here, "../application/services/job-milestones.ts"), "utf8");
    expect(ms).not.toContain("calendarEvent");
    expect(ms).not.toContain("createTask");
    expect(ms).not.toContain("JobWorkPackageStatus");

    const route = readFileSync(
      resolve(here, "../interfaces/http/routes/job-milestones.route.ts"),
      "utf8"
    );
    expect(route).toContain("/milestones");
    expect(route).not.toContain("JOB_MATCHER");
    expect(route).not.toContain("INLINE_IMAGE");

    const listRoute = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    const listHandler = listRoute.slice(
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs — List jobs"),
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs/:jobId — Job detail")
    );
    expect(listHandler).not.toContain("jobMilestone");
    expect(listHandler).not.toContain("scheduleSummary");

    const migration = readFileSync(
      resolve(here, "../../../../packages/db/prisma/migrations/20260929230000_job_milestones/migration.sql"),
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE "JobMilestone"');
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain("ON DELETE CASCADE");
  });
});
