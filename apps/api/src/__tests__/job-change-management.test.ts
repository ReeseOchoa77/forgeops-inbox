import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildChangesSummary,
  ChangeMgmtError,
  createChange,
  createChangeOrder,
  createDirective,
  createRfi,
  deleteRfi,
  isRfiOverdue,
  moneyToString,
  normalizeMoney,
  presentChange,
  toUtcDateOnly,
  updateChange,
  updateRfi,
} from "../application/services/job-change-management.js";

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date("2026-10-12T15:00:00.000Z");

describe("job change management", () => {
  it("treats NULL money as unknown and 0 as explicit zero", () => {
    expect(normalizeMoney(null)).toBeNull();
    expect(normalizeMoney("")).toBeNull();
    expect(moneyToString(normalizeMoney(0))).toBe("0.00");
    expect(moneyToString(normalizeMoney("1250.5"))).toBe("1250.50");
    expect(moneyToString(null)).toBeNull();
  });

  it("derives RFI overdue from OPEN/DRAFT + due date", () => {
    expect(isRfiOverdue("OPEN", "2026-10-10", now)).toBe(true);
    expect(isRfiOverdue("OPEN", "2026-10-15", now)).toBe(false);
    expect(isRfiOverdue("ANSWERED", "2026-10-01", now)).toBe(false);
    expect(isRfiOverdue("OPEN", null, now)).toBe(false);
  });

  it("stores dates as UTC midnight date-only", () => {
    expect(toUtcDateOnly(new Date("2026-10-15T00:00:00.000Z"))).toBe("2026-10-15");
  });

  it("rejects cross-job work packages on RFI create", async () => {
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobRfi: { findFirst: vi.fn().mockResolvedValue(null) },
      jobWorkPackage: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await expect(
      createRfi(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        number: "RFI-1",
        subject: "Beam conflict",
        workPackageIds: ["other"],
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("creates an RFI and answers it without mutating emails or packages", async () => {
    const created = {
      id: "rfi-1",
      jobId: "job-1",
      number: "RFI-17",
      subject: "Beam elevation",
      question: "Conflict?",
      status: "OPEN",
      submittedDate: new Date("2026-10-01T00:00:00.000Z"),
      responseDueDate: new Date("2026-09-01T00:00:00.000Z"),
      answeredDate: null,
      response: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      workPackages: [],
      documents: [],
      requestedBy: null,
      assignedTo: null,
      changes: [],
    };
    const prismaCreate = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobRfi: { findFirst: vi.fn().mockResolvedValue(null) },
      jobWorkPackage: { findMany: vi.fn().mockResolvedValue([]) },
      jobDocumentRecord: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobRfi: { create: vi.fn().mockResolvedValue(created) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await createRfi(prismaCreate as never, {
      workspaceId: "ws",
      jobId: "job-1",
      number: "RFI-17",
      subject: "Beam elevation",
      question: "Conflict?",
      actorUserId: "u1",
    });
    expect(dto.number).toBe("RFI-17");
    expect(dto.responseDueDate).toBe("2026-09-01");
    expect(dto.overdue).toBe(true);

    const answered = {
      ...created,
      status: "ANSWERED",
      response: "Raise beam",
      answeredDate: new Date("2026-10-11T00:00:00.000Z"),
    };
    const prismaUpdate = {
      jobRfi: {
        findFirst: vi.fn().mockResolvedValue(created),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobRfiWorkPackage: { deleteMany: vi.fn(), createMany: vi.fn() },
          jobRfiDocument: { deleteMany: vi.fn(), createMany: vi.fn() },
          jobRfi: { update: vi.fn().mockResolvedValue(answered) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const updated = await updateRfi(prismaUpdate as never, {
      workspaceId: "ws",
      jobId: "job-1",
      rfiId: "rfi-1",
      status: "ANSWERED",
      response: "Raise beam",
      actorUserId: "u1",
    });
    expect(updated.status).toBe("ANSWERED");
    expect(updated.answeredDate).toBe("2026-10-11");
  });

  it("creates a Change from an RFI with distinct cost vs sell and NULL vs zero", async () => {
    const created = {
      id: "ch-1",
      jobId: "job-1",
      number: "CH-004",
      title: "Connection redesign",
      description: null,
      type: "EXTRA",
      status: "IDENTIFIED",
      sourceRfiId: "rfi-1",
      sourceDirectiveId: null,
      changeOrderId: null,
      costImpact: { toString: () => "700.00" },
      sellImpact: { toString: () => "1250.00" },
      scheduleImpactDays: 7,
      scheduleImpactNote: null,
      identifiedDate: now,
      proposedDate: null,
      approvedDate: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      workPackages: [],
      sourceRfi: { id: "rfi-1", number: "RFI-17", subject: "Beam" },
      sourceDirective: null,
      changeOrder: null,
    };
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobChange: { findFirst: vi.fn().mockResolvedValue(null) },
      jobWorkPackage: { findMany: vi.fn().mockResolvedValue([]) },
      jobRfi: { findFirst: vi.fn().mockResolvedValue({ id: "rfi-1" }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobChange: { create: vi.fn().mockResolvedValue(created) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await createChange(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      number: "CH-004",
      title: "Connection redesign",
      type: "EXTRA",
      sourceRfiId: "rfi-1",
      costImpact: 700,
      sellImpact: 1250,
      scheduleImpactDays: 7,
      actorUserId: "u1",
    });
    expect(dto.costImpact).toBe("700.00");
    expect(dto.sellImpact).toBe("1250.00");
    expect(dto.sourceRfi?.number).toBe("RFI-17");
    expect(presentChange({ ...created, costImpact: null, sellImpact: { toString: () => "0.00" } })).toMatchObject({
      costImpact: null,
      sellImpact: "0.00",
    });
  });

  it("builds overview aggregates without hydrating full registers", async () => {
    const prisma = {
      jobRfi: {
        findMany: vi.fn().mockResolvedValue([
          { status: "OPEN", responseDueDate: new Date("2026-10-01T00:00:00.000Z") },
          { status: "OPEN", responseDueDate: new Date("2026-10-20T00:00:00.000Z") },
          { status: "CLOSED", responseDueDate: new Date("2026-10-01T00:00:00.000Z") },
        ]),
      },
      jobChange: {
        findMany: vi.fn().mockResolvedValue([
          { status: "PROPOSED", sellImpact: { add: (x: any) => x, toString: () => "1000.00" } },
          { status: "PROPOSED", sellImpact: null },
          { status: "APPROVED", sellImpact: { toString: () => "500.00" } },
        ]),
      },
      jobChangeOrder: { count: vi.fn().mockResolvedValue(1) },
    };
    // Fix Decimal add mock for proposed sum
    const d1 = { toString: () => "1000.00", add: (other: any) => ({ toString: () => "1000.00", add: other.add }) };
    prisma.jobChange.findMany = vi.fn().mockResolvedValue([
      { status: "PROPOSED", sellImpact: d1 },
      { status: "PROPOSED", sellImpact: null },
      { status: "APPROVED", sellImpact: { toString: () => "500.00" } },
    ]);
    const summary = await buildChangesSummary(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      now,
    });
    expect(summary.openRfiCount).toBe(2);
    expect(summary.overdueRfiCount).toBe(1);
    expect(summary.proposedChangeCount).toBe(2);
    expect(summary.pendingChangeOrderCount).toBe(1);
  });

  it("rejects invalid money", () => {
    expect(() => normalizeMoney("abc")).toThrow(ChangeMgmtError);
  });

  it("creates a Directive and multiple Changes from the same Directive", async () => {
    const dir = {
      id: "dir-1",
      jobId: "job-1",
      type: "ASI",
      status: "ACTIVE",
      number: "ASI-04",
      title: "Revised Stair Landing",
      issuedDate: new Date("2026-09-18T00:00:00.000Z"),
      summary: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      workPackages: [],
      documents: [],
      changes: [],
    };
    const prismaDir = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobDirective: { findFirst: vi.fn().mockResolvedValue(null) },
      jobWorkPackage: { findMany: vi.fn().mockResolvedValue([]) },
      jobDocumentRecord: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobDirective: { create: vi.fn().mockResolvedValue(dir) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const d = await createDirective(prismaDir as never, {
      workspaceId: "ws",
      jobId: "job-1",
      type: "ASI",
      number: "ASI-04",
      title: "Revised Stair Landing",
      issuedDate: "2026-09-18",
      actorUserId: "u1",
    });
    expect(d.type).toBe("ASI");
    expect(d.issuedDate).toBe("2026-09-18");

    const mkChange = (id: string, number: string) => ({
      id,
      jobId: "job-1",
      number,
      title: number,
      description: null,
      type: "EXTRA",
      status: "IDENTIFIED",
      sourceRfiId: null,
      sourceDirectiveId: "dir-1",
      changeOrderId: null,
      costImpact: null,
      sellImpact: null,
      scheduleImpactDays: null,
      scheduleImpactNote: null,
      identifiedDate: now,
      proposedDate: null,
      approvedDate: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      workPackages: [],
      sourceRfi: null,
      sourceDirective: { id: "dir-1", number: "ASI-04", title: "Revised Stair Landing", type: "ASI" },
      changeOrder: null,
    });
    for (const [id, number] of [
      ["ch-7", "CH-007"],
      ["ch-8", "CH-008"],
    ] as const) {
      const prismaCh = {
        job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
        jobChange: { findFirst: vi.fn().mockResolvedValue(null) },
        jobWorkPackage: { findMany: vi.fn().mockResolvedValue([]) },
        jobDirective: { findFirst: vi.fn().mockResolvedValue({ id: "dir-1" }) },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            jobChange: { create: vi.fn().mockResolvedValue(mkChange(id, number)) },
            jobActivityLog: { create: vi.fn() },
          })
        ),
      };
      const ch = await createChange(prismaCh as never, {
        workspaceId: "ws",
        jobId: "job-1",
        number,
        title: number,
        type: "EXTRA",
        sourceDirectiveId: "dir-1",
        actorUserId: "u1",
      });
      expect(ch.sourceDirective?.number).toBe("ASI-04");
      expect(ch.costImpact).toBeNull();
      expect(ch.sellImpact).toBeNull();
    }
  });

  it("bundles multiple Changes into a Change Order with explicit sell amount", async () => {
    const co = {
      id: "co-1",
      jobId: "job-1",
      number: "CO-02",
      title: "September changes",
      status: "DRAFT",
      submittedDate: null,
      approvedDate: null,
      sellAmount: { toString: () => "12400.00" },
      notes: null,
      createdAt: now,
      updatedAt: now,
      changes: [
        { id: "ch-3", number: "CH-003", title: "A", status: "APPROVED", sellImpact: null, costImpact: null },
        { id: "ch-4", number: "CH-004", title: "B", status: "APPROVED", sellImpact: null, costImpact: null },
      ],
    };
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobChangeOrder: { findFirst: vi.fn().mockResolvedValue(null) },
      jobChange: {
        findMany: vi.fn().mockResolvedValue([
          { id: "ch-3", changeOrderId: null },
          { id: "ch-4", changeOrderId: null },
        ]),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobChangeOrder: {
            create: vi.fn().mockResolvedValue({ id: "co-1", number: "CO-02", status: "DRAFT" }),
            findFirstOrThrow: vi.fn().mockResolvedValue(co),
          },
          jobChange: { updateMany: vi.fn() },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await createChangeOrder(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      number: "CO-02",
      title: "September changes",
      sellAmount: 12400,
      changeIds: ["ch-3", "ch-4"],
      actorUserId: "u1",
    });
    expect(dto.number).toBe("CO-02");
    expect(dto.sellAmount).toBe("12400.00");
    expect(dto.changes).toHaveLength(2);
  });

  it("rejects hard-delete of used RFIs and preserves linked Changes", async () => {
    await expect(
      deleteRfi(
        {
          jobRfi: {
            findFirst: vi.fn().mockResolvedValue({
              id: "rfi-1",
              status: "OPEN",
              changes: [{ id: "ch-1" }],
            }),
          },
        } as never,
        { workspaceId: "ws", jobId: "job-1", rfiId: "rfi-1", actorUserId: "u1" }
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    await expect(
      deleteRfi(
        {
          jobRfi: {
            findFirst: vi.fn().mockResolvedValue({
              id: "rfi-2",
              status: "ANSWERED",
              changes: [],
            }),
          },
        } as never,
        { workspaceId: "ws", jobId: "job-1", rfiId: "rfi-2", actorUserId: "u1" }
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects cross-job source RFI and change-order references", async () => {
    await expect(
      createChange(
        {
          job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
          jobChange: { findFirst: vi.fn().mockResolvedValue(null) },
          jobWorkPackage: { findMany: vi.fn().mockResolvedValue([]) },
          jobRfi: { findFirst: vi.fn().mockResolvedValue(null) },
        } as never,
        {
          workspaceId: "ws",
          jobId: "job-1",
          number: "CH-9",
          title: "Bad source",
          sourceRfiId: "other-job-rfi",
          actorUserId: "u1",
        }
      )
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(
      updateChange(
        {
          jobChange: {
            findFirst: vi.fn().mockResolvedValue({
              id: "ch-1",
              status: "IDENTIFIED",
              number: "CH-1",
              proposedDate: null,
              approvedDate: null,
            }),
          },
          jobChangeOrder: { findFirst: vi.fn().mockResolvedValue(null) },
        } as never,
        {
          workspaceId: "ws",
          jobId: "job-1",
          changeId: "ch-1",
          changeOrderId: "other-job-co",
          actorUserId: "u1",
        }
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("wires Changes tab without AI, auto milestone/package/fab mutation, or Job.totalCost writes", () => {
    const service = readFileSync(
      resolve(here, "../application/services/job-change-management.ts"),
      "utf8"
    );
    expect(service).toContain("JobRfi");
    expect(service).toContain("JobDirective");
    expect(service).toContain("JobChange");
    expect(service).toContain("JobChangeOrder");
    expect(service).toContain("costImpact");
    expect(service).toContain("sellImpact");
    expect(service).not.toContain("totalCost");
    expect(service).not.toContain("JobWorkPackageStatus");
    expect(service).not.toContain("createMilestone");
    expect(service).not.toContain("jobFabricationItem");
    expect(service).not.toContain("JOB_MATCHER");

    const detail = readFileSync(resolve(here, "../../../web/src/views/JobDetailView.tsx"), "utf8");
    expect(detail).toContain("key: 'changes'");
    expect(detail).toContain("<JobChangesView");
    expect(detail).toContain("<ChangesOverviewSummary");

    const listRoute = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    const listHandler = listRoute.slice(
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs — List jobs"),
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs/:jobId — Job detail")
    );
    expect(listHandler).not.toContain("jobRfi");
    expect(listHandler).not.toContain("changesSummary");

    const migration = readFileSync(
      resolve(
        here,
        "../../../../packages/db/prisma/migrations/20260929250000_job_change_management/migration.sql"
      ),
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE "JobRfi"');
    expect(migration).toContain('CREATE TABLE "JobDirective"');
    expect(migration).toContain('CREATE TABLE "JobChange"');
    expect(migration).toContain('CREATE TABLE "JobChangeOrder"');
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain('"costImpact" DECIMAL(14,2)');
    expect(migration).toContain('"sellImpact" DECIMAL(14,2)');
  });
});
