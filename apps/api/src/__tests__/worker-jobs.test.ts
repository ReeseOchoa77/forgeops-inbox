import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { QueueNames } from "@forgeops/shared";

import {
  WorkerJobActionError,
  applicationRunIsOrphaned,
  cancelWorkerJob,
  listWorkerJobs,
  removeWorkerJob,
  retryWorkerJob,
  type WorkerQueueHandle,
  type WorkerQueueJob,
} from "../application/services/worker-jobs.js";

function job(overrides: Partial<WorkerQueueJob> & Pick<WorkerQueueJob, "id" | "data">): WorkerQueueJob {
  return {
    name: "job",
    timestamp: 1_700_000_000_000,
    attemptsMade: 1,
    opts: { attempts: 3 },
    getState: async () => "waiting",
    remove: async () => {},
    retry: async () => {},
    ...overrides,
  };
}

function queue(byState: Record<string, WorkerQueueJob[]>): WorkerQueueHandle & { removed: string[]; retried: string[] } {
  const removed: string[] = [];
  const retried: string[] = [];
  const wrapped: Record<string, WorkerQueueJob[]> = {};
  for (const [state, jobs] of Object.entries(byState)) {
    wrapped[state] = jobs.map((item) => ({
      ...item,
      remove: async () => {
        removed.push(item.id ?? "");
      },
      retry: async () => {
        retried.push(item.id ?? "");
      },
    }));
  }
  return {
    removed,
    retried,
    getJobCounts: async () => ({
      active: wrapped.active?.length ?? 0,
      waiting: wrapped.waiting?.length ?? 0,
      delayed: wrapped.delayed?.length ?? 0,
      paused: 0,
      failed: wrapped.failed?.length ?? 0,
      completed: wrapped.completed?.length ?? 0,
    }),
    getJobs: async (types) => wrapped[types[0] ?? ""] ?? [],
    getJob: async (id) => Object.values(wrapped).flat().find((item) => item.id === id),
    isPaused: async () => false,
    pause: async () => {},
    resume: async () => {},
    getRepeatableJobs: async () => [],
  };
}

function prisma(overrides?: {
  imports?: Array<{
    id: string;
    status: string;
    processedCount: number;
    requestedLimit: number;
    errorMessage: string | null;
    workspaceId?: string;
    inboxConnectionId?: string;
  }>;
  emails?: Array<{ id: string; email: string }>;
}): PrismaClient {
  const imports = overrides?.imports ?? [];
  return {
    mailboxHistoricalImport: {
      findMany: async (args: { where?: { id?: { in?: string[] }; status?: unknown }; select?: { status?: boolean } }) => {
        if (args.where?.id?.in) {
          return imports.filter((row) => args.where?.id?.in?.includes(row.id));
        }
        if (args.select && !("status" in (args.select ?? {})) && args.where?.status) {
          return [];
        }
        if (args.where?.status) return [];
        return imports;
      },
      updateMany: async () => ({ count: 1 }),
    },
    mailboxReclassifyRun: {
      findMany: async () => [],
      findUnique: async () => null,
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
    projectFolderEmailAnalyzeRun: { findMany: async () => [] },
    inboxConnection: {
      findMany: async () => overrides?.emails ?? [],
      findUnique: async () => null,
    },
  } as unknown as PrismaClient;
}

function bundle(name: string, handle: WorkerQueueHandle) {
  return [{ name, queue: handle }] as unknown as Parameters<typeof listWorkerJobs>[0]["queues"];
}

describe("listWorkerJobs", () => {
  const classify = QueueNames.MAILBOX_CLASSIFY;

  it("shows active, waiting, delayed, failed, and retained completed jobs", async () => {
    const handle = queue({
      active: [job({ id: "active-1", data: { workspaceId: "ws-a", emailMessageId: "m1" } })],
      waiting: [job({ id: "wait-1", data: { workspaceId: "ws-a", emailMessageId: "m2" } })],
      delayed: [job({ id: "delay-1", data: { workspaceId: "ws-a", emailMessageId: "m3" } })],
      failed: [job({ id: "fail-1", data: { workspaceId: "ws-a", emailMessageId: "m4" }, failedReason: "boom" })],
      completed: [job({ id: "done-1", data: { workspaceId: "ws-a", emailMessageId: "m5" } })],
    });
    const listed = await listWorkerJobs(
      { queues: bundle(classify, handle), prisma: prisma() },
      { status: "all", queue: classify }
    );
    const states = listed.jobs.map((row) => `${row.jobId}:${row.displayState}`).sort();
    expect(states).toEqual([
      "active-1:ACTIVE",
      "delay-1:DELAYED",
      "done-1:COMPLETED",
      "fail-1:FAILED",
      "wait-1:QUEUED",
    ]);
    expect(listed.summary.active).toBe(1);
    expect(listed.summary.queued).toBe(1);
    expect(listed.summary.failed).toBe(1);
  });

  it("hides another workspace when a workspace filter is set", async () => {
    const handle = queue({
      waiting: [
        job({ id: "mine", data: { workspaceId: "ws-a" } }),
        job({ id: "theirs", data: { workspaceId: "ws-b" } }),
      ],
    });
    const listed = await listWorkerJobs(
      { queues: bundle(classify, handle), prisma: prisma() },
      { status: "queued", queue: classify, workspaceId: "ws-a" }
    );
    expect(listed.jobs.map((row) => row.jobId)).toEqual(["mine"]);
  });

  it("uses persisted historical import counts and does not invent a total", async () => {
    const handle = queue({
      active: [
        job({
          id: "historical-import-imp-1",
          name: "mailbox-historical-import",
          data: { workspaceId: "ws-a", inboxConnectionId: "cx", importId: "imp-1" },
        }),
      ],
    });
    const listed = await listWorkerJobs(
      {
        queues: bundle(QueueNames.MAILBOX_HISTORICAL_IMPORT, handle),
        prisma: prisma({
          imports: [
            {
              id: "imp-1",
              status: "RUNNING",
              processedCount: 1250,
              requestedLimit: 4812,
              errorMessage: null,
            },
          ],
          emails: [{ id: "cx", email: "estimating@company.com" }],
        }),
      },
      { status: "active", queue: QueueNames.MAILBOX_HISTORICAL_IMPORT }
    );
    expect(listed.jobs[0]?.progress).toMatchObject({
      current: 1250,
      total: 4812,
      unit: "messages",
    });
    expect(listed.jobs[0]?.progress?.percent).toBeCloseTo(26, 0);
    expect(listed.jobs[0]?.resourceLabel).toBe("estimating@company.com");
    expect(listed.jobs[0]?.capabilities.pause).toBe(false);
    expect(listed.jobs[0]?.capabilities.revert).toBe(false);
    expect(listed.jobs[0]?.capabilities.cancel).toBe(true);
  });

  it("flags a running import with no queue job as stale", async () => {
    const handle = queue({});
    const db = prisma();
    (db.mailboxHistoricalImport as unknown as {
      findMany: (args: { where?: { status?: unknown } }) => Promise<unknown[]>;
    }).findMany = async (args) => {
      if (args.where?.status) {
        return [{ id: "imp-stale", workspaceId: "ws-a", inboxConnectionId: "cx" }];
      }
      return [
        {
          id: "imp-stale",
          status: "RUNNING",
          processedCount: 10,
          requestedLimit: 100,
          errorMessage: null,
        },
      ];
    };
    const listed = await listWorkerJobs(
      { queues: bundle(QueueNames.MAILBOX_HISTORICAL_IMPORT, handle), prisma: db },
      { status: "active", queue: QueueNames.MAILBOX_HISTORICAL_IMPORT }
    );
    expect(listed.jobs[0]?.displayState).toBe("STALE");
    expect(listed.jobs[0]?.attention).toBe("INCONSISTENT");
  });

  it("shows a running folder analysis when its BullMQ job is missing", async () => {
    const old = new Date("2026-09-24T18:34:24.000Z");
    const handle = queue({});
    const db = prisma();
    (db.projectFolderEmailAnalyzeRun as unknown as { findMany: (args: { where?: { status?: unknown } }) => Promise<unknown[]> }).findMany =
      async (args) => {
        if (args.where?.status) {
          return [{ id: "cmufuolb20008zo5ibynqhai5", workspaceId: "ws-a", inboxConnectionId: "cx" }];
        }
        return [{
          id: "cmufuolb20008zo5ibynqhai5",
          status: "RUNNING",
          errorMessage: null,
          updatedAt: old,
          progress: {
            processed: 300,
            created: 100,
            existing: 100,
            foldersDone: 0,
            foldersTotal: 3,
            currentFolderName: "Nova Academy",
          },
        }];
      };
    const listed = await listWorkerJobs(
      { queues: bundle(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, handle), prisma: db },
      { status: "all", queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE }
    );
    expect(listed.jobs).toHaveLength(1);
    expect(listed.jobs[0]?.displayState).toBe("STALE");
    expect(listed.jobs[0]?.attention).toBe("INCONSISTENT");
    expect(listed.jobs[0]?.queueState).toBeNull();
    expect(listed.jobs[0]?.runState).toBe("RUNNING");
    expect(listed.jobs[0]?.lastProgressAt).toBe(old.toISOString());
    expect(listed.jobs[0]?.progress?.stage).toContain("200 examined");
    expect(listed.jobs[0]?.progress?.stage).toContain("Nova Academy");
    expect(listed.jobs[0]?.progress?.stage).toContain("0/3");
    expect(listed.jobs[0]?.capabilities.cancel).toBe(true);
  });

  it("does not mark an active BullMQ job stale when progress is old", async () => {
    const old = new Date("2026-09-24T18:34:24.000Z");
    const active = job({
      id: "project-folder-email-analyze-run-live",
      data: { workspaceId: "ws-a", inboxConnectionId: "cx", runId: "run-live" },
      getState: async () => "active",
      processedOn: Date.now(),
    });
    const handle = queue({});
    handle.getJobs = async () => [];
    handle.getJob = async (id) => (id === active.id ? active : undefined);
    const db = prisma();
    (db.projectFolderEmailAnalyzeRun as unknown as { findMany: (args: { where?: { status?: unknown } }) => Promise<unknown[]> }).findMany =
      async (args) => {
        if (args.where?.status) {
          return [{ id: "run-live", workspaceId: "ws-a", inboxConnectionId: "cx" }];
        }
        return [{
          id: "run-live",
          status: "RUNNING",
          errorMessage: null,
          updatedAt: old,
          progress: { processed: 50, created: 50, existing: 0, foldersDone: 0, foldersTotal: 1, currentFolderName: "Live" },
        }];
      };
    const listed = await listWorkerJobs(
      { queues: bundle(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, handle), prisma: db },
      { status: "all", queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE }
    );
    expect(listed.jobs.map((row) => row.displayState)).toEqual(["ACTIVE"]);
    expect(listed.jobs[0]?.attention).toBeNull();
    expect(listed.jobs[0]?.queueState).toBe("active");
    expect(listed.jobs[0]?.capabilities.cancel).toBe(true);
  });

  it("still lists the application run when Redis reads fail", async () => {
    const handle = queue({});
    handle.getJobCounts = async () => {
      throw new Error("redis down");
    };
    handle.getJobs = async () => {
      throw new Error("redis down");
    };
    handle.getJob = async () => {
      throw new Error("redis down");
    };
    const db = prisma();
    (db.projectFolderEmailAnalyzeRun as unknown as { findMany: (args: { where?: { status?: unknown } }) => Promise<unknown[]> }).findMany =
      async (args) => {
        if (args.where?.status) {
          return [{ id: "run-redis", workspaceId: "ws-a", inboxConnectionId: "cx" }];
        }
        return [{
          id: "run-redis",
          status: "RUNNING",
          errorMessage: null,
          updatedAt: new Date("2026-09-24T18:34:24.000Z"),
          progress: { foldersDone: 0, foldersTotal: 3, processed: 200, created: 100, existing: 100 },
        }];
      };
    const listed = await listWorkerJobs(
      { queues: bundle(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, handle), prisma: db },
      { status: "all", queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE }
    );
    expect(listed.jobs).toHaveLength(1);
    expect(listed.jobs[0]?.queueUnreadable).toBe(true);
    expect(listed.jobs[0]?.attention).toBeNull();
    expect(listed.jobs[0]?.runState).toBe("RUNNING");
    expect(listed.jobs[0]?.capabilities.cancel).toBe(false);
  });

  it("marks a finished BullMQ job orphaned while the application run is still RUNNING", async () => {
    const old = new Date("2026-09-24T18:34:24.000Z");
    const handle = queue({
      failed: [
        job({
          id: "project-folder-email-analyze-run-done",
          data: { workspaceId: "ws-a", inboxConnectionId: "cx", runId: "run-done" },
          failedReason: "stalled",
          getState: async () => "failed",
        }),
      ],
    });
    const db = prisma();
    (db.projectFolderEmailAnalyzeRun as unknown as { findMany: (args: { where?: { status?: unknown; id?: { in?: string[] } } }) => Promise<unknown[]> }).findMany =
      async (args) => {
        if (args.where?.id?.in) {
          return [{
            id: "run-done",
            status: "RUNNING",
            errorMessage: null,
            updatedAt: old,
            progress: { foldersDone: 0, foldersTotal: 3, processed: 200, created: 200, existing: 0, currentFolderName: "Nova Academy" },
          }];
        }
        if (args.where?.status) {
          return [{ id: "run-done", workspaceId: "ws-a", inboxConnectionId: "cx" }];
        }
        return [];
      };
    const listed = await listWorkerJobs(
      { queues: bundle(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, handle), prisma: db },
      { status: "all", queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE }
    );
    expect(listed.jobs).toHaveLength(1);
    expect(listed.jobs[0]?.queueState).toBe("failed");
    expect(listed.jobs[0]?.displayState).toBe("STALE");
    expect(listed.jobs[0]?.attention).toBe("INCONSISTENT");
    expect(listed.jobs[0]?.runState).toBe("RUNNING");
    expect(listed.jobs[0]?.capabilities.cancel).toBe(true);
  });
});

describe("application run orphan rule", () => {
  const now = Date.parse("2026-09-25T15:00:00.000Z");
  const old = new Date("2026-09-24T18:34:24.000Z");

  it("treats a missing queue job with old progress as orphaned", () => {
    expect(applicationRunIsOrphaned({
      appStatus: "RUNNING",
      bullState: null,
      lastProgressAt: old,
      now,
    })).toBe(true);
  });

  it("keeps an active queue job even when progress is old", () => {
    expect(applicationRunIsOrphaned({
      appStatus: "RUNNING",
      bullState: "active",
      lastProgressAt: old,
      now,
    })).toBe(false);
  });

  it("does not call a run orphaned when the queue could not be read", () => {
    expect(applicationRunIsOrphaned({
      appStatus: "RUNNING",
      bullState: null,
      lastProgressAt: old,
      now,
      queueUnreadable: true,
    })).toBe(false);
  });
});

describe("worker job actions", () => {
  it("retries a failed job in place", async () => {
    const handle = queue({
      failed: [job({ id: "fail-1", data: { workspaceId: "ws-a", taskMode: "REMOVE_ONLY", reclassifyRunId: "run-1" }, getState: async () => "failed" })],
    });
    const result = await retryWorkerJob(
      { queues: bundle(QueueNames.MAILBOX_CLASSIFY, handle) },
      QueueNames.MAILBOX_CLASSIFY,
      "fail-1"
    );
    expect(result.jobId).toBe("fail-1");
    expect(handle.retried).toEqual(["fail-1"]);
  });

  it("refuses to remove an active job", async () => {
    const handle = queue({
      active: [job({ id: "active-1", data: { workspaceId: "ws-a" }, getState: async () => "active" })],
    });
    await expect(
      removeWorkerJob({ queues: bundle(QueueNames.MAILBOX_CLASSIFY, handle) }, QueueNames.MAILBOX_CLASSIFY, "active-1")
    ).rejects.toBeInstanceOf(WorkerJobActionError);
    expect(handle.removed).toEqual([]);
  });

  it("removes a waiting job and marks a historical import cancelled", async () => {
    const updates: unknown[] = [];
    const handle = queue({
      waiting: [
        job({
          id: "historical-import-imp-1",
          data: { workspaceId: "ws-a", importId: "imp-1" },
          getState: async () => "waiting",
        }),
      ],
    });
    const db = prisma();
    (db.mailboxHistoricalImport as unknown as { updateMany: (args: unknown) => Promise<{ count: number }> }).updateMany =
      async (args) => {
        updates.push(args);
        return { count: 1 };
      };
    const result = await cancelWorkerJob(
      { queues: bundle(QueueNames.MAILBOX_HISTORICAL_IMPORT, handle), prisma: db },
      QueueNames.MAILBOX_HISTORICAL_IMPORT,
      "historical-import-imp-1"
    );
    expect(result.mode).toBe("removed");
    expect(handle.removed).toEqual(["historical-import-imp-1"]);
    expect(updates[0]).toMatchObject({
      where: { id: "imp-1", status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED" },
    });
  });

  it("aborts a running folder analysis without removing the queue job", async () => {
    const updates: unknown[] = [];
    const handle = queue({
      active: [
        job({
          id: "project-folder-email-analyze-run-1",
          data: { workspaceId: "ws-a", runId: "run-1" },
          getState: async () => "active",
        }),
      ],
    });
    const db = prisma();
    (db.projectFolderEmailAnalyzeRun as unknown as {
      updateMany: (args: unknown) => Promise<{ count: number }>;
    }).updateMany = async (args) => {
      updates.push(args);
      return { count: 1 };
    };
    const result = await cancelWorkerJob(
      { queues: bundle(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, handle), prisma: db },
      QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
      "project-folder-email-analyze-run-1"
    );
    expect(result.mode).toBe("cooperative");
    expect(handle.removed).toEqual([]);
    expect(updates[0]).toMatchObject({
      where: { id: "run-1", status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED" },
    });
  });

  it("aborts an orphaned folder analysis when the queue job is gone", async () => {
    const updates: unknown[] = [];
    const handle = queue({});
    const db = prisma();
    (db.projectFolderEmailAnalyzeRun as unknown as {
      updateMany: (args: unknown) => Promise<{ count: number }>;
      findUnique: () => Promise<{ workspaceId: string }>;
    }).updateMany = async (args) => {
      updates.push(args);
      return { count: 1 };
    };
    (db.projectFolderEmailAnalyzeRun as unknown as { findUnique: () => Promise<{ workspaceId: string }> }).findUnique =
      async () => ({ workspaceId: "ws-a" });
    const result = await cancelWorkerJob(
      { queues: bundle(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, handle), prisma: db },
      QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
      "project-folder-email-analyze-cmufuolb20008zo5ibynqhai5"
    );
    expect(result.mode).toBe("closed");
    expect(result.workspaceId).toBe("ws-a");
    expect(updates[0]).toMatchObject({
      where: { id: "cmufuolb20008zo5ibynqhai5", status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED" },
    });
  });
});
