import { describe, expect, it, vi } from "vitest";
import {
  canAutoRequeueClassification,
  MAX_AUTO_CLASSIFICATION_ATTEMPTS,
  truncateClassificationError,
} from "@forgeops/shared";
import {
  retryClassificationBulk,
  retryClassificationForMessage,
  RetryClassificationError,
} from "../application/services/retry-classification.js";

function mockQueue(opts?: {
  getState?: string | null;
  addError?: Error;
}) {
  const remove = vi.fn().mockResolvedValue(undefined);
  const add = opts?.addError
    ? vi.fn().mockRejectedValue(opts.addError)
    : vi.fn().mockResolvedValue({});
  const getJob =
    opts?.getState == null
      ? vi.fn().mockResolvedValue(null)
      : vi.fn().mockResolvedValue({
          getState: async () => opts.getState,
          remove,
        });
  return { add, getJob, remove };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    workspaceId: "ws1",
    inboxConnectionId: "conn1",
    inboxConnection: { ingestionSource: "NATIVE" },
    classifications: [],
    ...overrides,
  };
}

describe("retryClassificationForMessage", () => {
  it("queues unclassified native message via ensureMailboxClassifyJob", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      emailMessage: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(messageRow())
          .mockResolvedValue(null),
        update,
      },
    };
    const queue = mockQueue();
    const outcome = await retryClassificationForMessage({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      emailMessageId: "m1",
      initiatedBy: "u1",
    });
    expect(outcome).toBe("queued");
    expect(queue.add).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "m1" },
        data: expect.objectContaining({ classificationStatus: "PENDING" }),
      })
    );
  });

  it("returns already_processing for in-flight BullMQ job", async () => {
    const prisma = {
      emailMessage: {
        findFirst: vi.fn().mockResolvedValue(messageRow()),
        update: vi.fn(),
      },
    };
    const queue = mockQueue({ getState: "active" });
    const outcome = await retryClassificationForMessage({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      emailMessageId: "m1",
    });
    expect(outcome).toBe("already_processing");
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("re-adds after failed terminal job", async () => {
    const prisma = {
      emailMessage: {
        findFirst: vi.fn().mockResolvedValue(messageRow()),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const queue = mockQueue({ getState: "failed" });
    const outcome = await retryClassificationForMessage({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      emailMessageId: "m1",
    });
    expect(outcome).toBe("queued");
    expect(queue.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it("skips already classified messages", async () => {
    const prisma = {
      emailMessage: {
        findFirst: vi.fn().mockResolvedValue(
          messageRow({ classifications: [{ id: "c1" }] })
        ),
        update: vi.fn(),
      },
    };
    const queue = mockQueue();
    const outcome = await retryClassificationForMessage({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      emailMessageId: "m1",
    });
    expect(outcome).toBe("already_classified");
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("rejects cross-workspace message ids", async () => {
    const prisma = {
      emailMessage: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ workspaceId: "other-ws" }),
      },
    };
    await expect(
      retryClassificationForMessage({
        prisma: prisma as never,
        queue: mockQueue() as never,
        workspaceId: "ws1",
        emailMessageId: "m1",
      })
    ).rejects.toMatchObject({ code: "CROSS_WORKSPACE" });
  });
});

describe("retryClassificationBulk", () => {
  it("reclassifies only selected message ids", async () => {
    const findFirst = vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(messageRow({ id: where.id }))
    );
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn1",
          ingestionSource: "NATIVE",
        }),
      },
      emailMessage: {
        findFirst,
        findMany: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const queue = mockQueue();
    const result = await retryClassificationBulk({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      messageIds: ["m1", "m2"],
    });
    expect(result.totalFound).toBe(2);
    expect(result.queued).toBe(2);
    expect(prisma.emailMessage.findMany).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it("allUnclassified scopes to mailbox and pages results", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn1",
          ingestionSource: "NATIVE",
        }),
      },
      emailMessage: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(messageRow({ id: where.id, inboxConnectionId: "conn1" }))
        ),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "m1" }, { id: "m2" }])
          .mockResolvedValueOnce([]),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const queue = mockQueue();
    const result = await retryClassificationBulk({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      allUnclassified: true,
      limit: 50,
    });
    expect(result.queued).toBe(2);
    expect(prisma.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws1",
          inboxConnectionId: "conn1",
          classifications: { none: {} },
        }),
      })
    );
  });
});

describe("classification processing helpers", () => {
  it("caps auto requeue after FAILED or max attempts", () => {
    expect(
      canAutoRequeueClassification({
        classificationAttemptCount: 0,
        classificationStatus: null,
      })
    ).toBe(true);
    expect(
      canAutoRequeueClassification({
        classificationAttemptCount: MAX_AUTO_CLASSIFICATION_ATTEMPTS,
        classificationStatus: "PENDING",
      })
    ).toBe(false);
    expect(
      canAutoRequeueClassification({
        classificationAttemptCount: 1,
        classificationStatus: "FAILED",
      })
    ).toBe(false);
  });

  it("truncates classification errors", () => {
    const long = "x".repeat(600);
    expect(truncateClassificationError(long).length).toBeLessThanOrEqual(481);
  });
});

describe("RetryClassificationError", () => {
  it("is constructible", () => {
    const e = new RetryClassificationError("INVALID_REQUEST", "bad");
    expect(e.code).toBe("INVALID_REQUEST");
  });
});
