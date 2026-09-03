import { describe, expect, it, vi } from "vitest";
import {
  processMailboxReclassifyRun,
  recordReclassifyClassifyOutcome,
} from "../application/processors/mailbox-reclassify.processor.js";
import { MAILBOX_RECLASSIFY_ENQUEUE_BATCH } from "@forgeops/shared";

describe("processMailboxReclassifyRun", () => {
  it("enqueues with forceReclassify in bounded batches and stops on CANCELLING", async () => {
    const ids = Array.from({ length: MAILBOX_RECLASSIFY_ENQUEUE_BATCH + 5 }, (_, i) => ({
      id: `m${i}`,
    }));
    let status: string = "RUNNING";
    let enqueued = 0;

    const classifyAdd = vi.fn().mockImplementation(async () => {
      enqueued += 1;
      if (enqueued >= 3) status = "CANCELLING";
      return {};
    });
    const classifyGetJob = vi.fn().mockResolvedValue(null);

    const prisma = {
      mailboxReclassifyRun: {
        findFirst: vi.fn().mockImplementation(async () => ({
          id: "run1",
          workspaceId: "ws",
          inboxConnectionId: "c1",
            status,
          filtersSnapshot: { category: "BUSINESS" },
          selectedMessageIds: null,
          taskMode: "REMOVE_ONLY",
          totalMatched: ids.length,
          queued: 0,
          skipped: 0,
          startedAt: null,
        })),
        update: vi.fn().mockImplementation(async ({ data }: { data: { status?: string } }) => {
          if (data.status) status = data.status;
          return {};
        }),
      },
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          email: "ed@x.com",
          ingestionSource: "NATIVE",
        }),
      },
      emailMessage: {
        findMany: vi.fn().mockImplementation(async () => {
          if (status === "CANCELLING" || status === "CANCELLED") return [];
          return ids.slice(0, MAILBOX_RECLASSIFY_ENQUEUE_BATCH);
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const result = await processMailboxReclassifyRun(
      {
        workspaceId: "ws",
        inboxConnectionId: "c1",
        runId: "run1",
        initiatedBy: "u1",
      },
      {
        prisma: prisma as never,
        classifyQueue: { add: classifyAdd, getJob: classifyGetJob } as never,
      }
    );

    expect(result.status).toBe("cancelled");
    expect(classifyAdd.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(classifyAdd.mock.calls.length).toBeLessThan(MAILBOX_RECLASSIFY_ENQUEUE_BATCH);
    expect(classifyAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        forceReclassify: true,
        reclassifyRunId: "run1",
        taskMode: "REMOVE_ONLY",
        emailMessageId: "m0",
      }),
      expect.anything()
    );
  });

  it("marks COMPLETED when nothing to enqueue", async () => {
    const prisma = {
      mailboxReclassifyRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "run1",
          workspaceId: "ws",
          inboxConnectionId: "c1",
          status: "PENDING",
          filtersSnapshot: {},
          selectedMessageIds: null,
          taskMode: "REMOVE_ONLY",
          totalMatched: 0,
          queued: 0,
          skipped: 0,
          startedAt: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          email: "ed@x.com",
          ingestionSource: "NATIVE",
        }),
      },
      emailMessage: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    };

    const result = await processMailboxReclassifyRun(
      { workspaceId: "ws", inboxConnectionId: "c1", runId: "run1" },
      {
        prisma: prisma as never,
        classifyQueue: {
          add: vi.fn(),
          getJob: vi.fn().mockResolvedValue(null),
        } as never,
      }
    );

    expect(result.status).toBe("completed");
    expect(result.queued).toBe(0);
    expect(prisma.mailboxReclassifyRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
  });
});

describe("recordReclassifyClassifyOutcome", () => {
  it("finalizes COMPLETED when accounted >= queued", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      mailboxReclassifyRun: {
        update,
        findFirst: vi.fn().mockResolvedValue({
          id: "run1",
          status: "RUNNING",
          queued: 2,
          completed: 2,
          failed: 0,
          skipped: 0,
        }),
      },
    };

    await recordReclassifyClassifyOutcome({
      prisma: prisma as never,
      reclassifyRunId: "run1",
      outcome: "completed",
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completed: { increment: 1 } }),
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
  });

  it("does not reopen CANCELLED runs", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      mailboxReclassifyRun: {
        update,
        findFirst: vi.fn().mockResolvedValue({
          id: "run1",
          status: "CANCELLED",
          queued: 10,
          completed: 1,
          failed: 0,
          skipped: 0,
        }),
      },
    };

    await recordReclassifyClassifyOutcome({
      prisma: prisma as never,
      reclassifyRunId: "run1",
      outcome: "completed",
    });

    // counter bump only — no status flip to COMPLETED
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({
      completed: { increment: 1 },
    });
  });
});
