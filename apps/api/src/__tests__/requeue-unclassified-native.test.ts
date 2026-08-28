import { describe, expect, it, vi } from "vitest";
import {
  REQUEUE_UNCLASSIFIED_MAX_LIMIT,
  RequeueUnclassifiedError,
  ensureMailboxClassifyJob,
  findUnclassifiedNativeMessageIds,
  requeueUnclassifiedNativeMessages,
} from "../application/services/requeue-unclassified-native.js";
import { buildMailboxClassifyJobId, QueueNames } from "@forgeops/shared";

describe("requeueUnclassifiedNativeMessages", () => {
  it("enqueues NATIVE messages with no Classification", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn1",
          ingestionSource: "NATIVE",
        }),
      },
      emailMessage: {
        findMany: vi.fn().mockResolvedValue([{ id: "m1" }, { id: "m2" }]),
      },
    };
    const add = vi.fn().mockResolvedValue({});
    const getJob = vi.fn().mockResolvedValue(null);

    const result = await requeueUnclassifiedNativeMessages({
      prisma: prisma as never,
      queue: { add, getJob } as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      limit: 50,
      initiatedBy: "user1",
    });

    expect(result).toEqual({
      eligibleCount: 2,
      enqueuedCount: 2,
      skippedCount: 0,
    });
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith(
      QueueNames.MAILBOX_CLASSIFY,
      {
        workspaceId: "ws1",
        inboxConnectionId: "conn1",
        emailMessageId: "m1",
        initiatedBy: "user1",
      },
      expect.objectContaining({
        jobId: buildMailboxClassifyJobId("m1"),
      })
    );
    expect(prisma.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "ws1",
          inboxConnectionId: "conn1",
          classifications: { none: {} },
        },
        take: 50,
      })
    );
  });

  it("eligibility query excludes messages that already have Classification", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await findUnclassifiedNativeMessageIds({
      prisma: { emailMessage: { findMany } } as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      limit: 10,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          classifications: { none: {} },
        }),
      })
    );
  });

  it("rejects N8N mailboxes", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn1",
          ingestionSource: "N8N",
        }),
      },
      emailMessage: { findMany: vi.fn() },
    };
    await expect(
      requeueUnclassifiedNativeMessages({
        prisma: prisma as never,
        queue: { add: vi.fn(), getJob: vi.fn() } as never,
        workspaceId: "ws1",
        inboxConnectionId: "conn1",
      })
    ).rejects.toMatchObject({
      code: "NOT_NATIVE",
    } satisfies Partial<RequeueUnclassifiedError>);
    expect(prisma.emailMessage.findMany).not.toHaveBeenCalled();
  });

  it("rejects missing connection / wrong workspace", async () => {
    const prisma = {
      inboxConnection: { findFirst: vi.fn().mockResolvedValue(null) },
      emailMessage: { findMany: vi.fn() },
    };
    await expect(
      requeueUnclassifiedNativeMessages({
        prisma: prisma as never,
        queue: { add: vi.fn(), getJob: vi.fn() } as never,
        workspaceId: "ws1",
        inboxConnectionId: "missing",
      })
    ).rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND" });
  });

  it("skips inflight BullMQ jobs (idempotent) and requeues failed jobs", async () => {
    const removeFailed = vi.fn().mockResolvedValue(undefined);
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({
        getState: async () => "waiting",
        remove: vi.fn(),
      })
      .mockResolvedValueOnce({
        getState: async () => "failed",
        remove: removeFailed,
      });
    const add = vi.fn().mockResolvedValue({});

    const wait = await ensureMailboxClassifyJob({
      queue: { add, getJob } as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      emailMessageId: "inflight",
    });
    expect(wait).toBe("skipped_inflight");
    expect(add).not.toHaveBeenCalled();

    const failed = await ensureMailboxClassifyJob({
      queue: { add, getJob } as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      emailMessageId: "failed-msg",
    });
    expect(failed).toBe("enqueued");
    expect(removeFailed).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      QueueNames.MAILBOX_CLASSIFY,
      expect.objectContaining({ emailMessageId: "failed-msg" }),
      expect.objectContaining({
        jobId: buildMailboxClassifyJobId("failed-msg"),
      })
    );
  });

  it("enforces max limit", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn1",
          ingestionSource: "NATIVE",
        }),
      },
      emailMessage: { findMany },
    };
    await requeueUnclassifiedNativeMessages({
      prisma: prisma as never,
      queue: { add: vi.fn(), getJob: vi.fn().mockResolvedValue(null) } as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      limit: 9999,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: REQUEUE_UNCLASSIFIED_MAX_LIMIT })
    );
  });

  it("does not reference rules-normalizer; uses shared mailbox-classify enqueue", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL(
          "../application/services/requeue-unclassified-native.ts",
          import.meta.url
        ),
        "utf8"
      )
    );
    expect(src).not.toMatch(/rules-normalizer|classifyNormalizedEmail/);
    expect(src).toContain("ensureMailboxClassifyJob");
  });
});
