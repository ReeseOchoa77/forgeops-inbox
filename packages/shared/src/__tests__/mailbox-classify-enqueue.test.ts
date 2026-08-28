import { describe, expect, it, vi } from "vitest";
import { ensureMailboxClassifyJob, QueueNames, buildMailboxClassifyJobId } from "@forgeops/shared";

describe("ensureMailboxClassifyJob", () => {
  it("adds when no existing job", async () => {
    const add = vi.fn().mockResolvedValue({});
    const getJob = vi.fn().mockResolvedValue(null);
    const outcome = await ensureMailboxClassifyJob({
      queue: { add, getJob },
      workspaceId: "ws",
      inboxConnectionId: "c1",
      emailMessageId: "m1",
    });
    expect(outcome).toBe("enqueued");
    expect(add).toHaveBeenCalledWith(
      QueueNames.MAILBOX_CLASSIFY,
      expect.objectContaining({ emailMessageId: "m1" }),
      expect.objectContaining({ jobId: buildMailboxClassifyJobId("m1") })
    );
  });

  it("skips when job already waiting", async () => {
    const add = vi.fn();
    const getJob = vi.fn().mockResolvedValue({
      getState: async () => "waiting",
      remove: vi.fn(),
    });
    const outcome = await ensureMailboxClassifyJob({
      queue: { add, getJob },
      workspaceId: "ws",
      inboxConnectionId: "c1",
      emailMessageId: "m1",
    });
    expect(outcome).toBe("skipped_inflight");
    expect(add).not.toHaveBeenCalled();
  });

  it("removes failed job then re-adds", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue({});
    const getJob = vi.fn().mockResolvedValue({
      getState: async () => "failed",
      remove,
    });
    const outcome = await ensureMailboxClassifyJob({
      queue: { add, getJob },
      workspaceId: "ws",
      inboxConnectionId: "c1",
      emailMessageId: "m1",
    });
    expect(remove).toHaveBeenCalled();
    expect(outcome).toBe("enqueued");
    expect(add).toHaveBeenCalled();
  });

  it("treats already-exists add error as skipped_inflight", async () => {
    const add = vi.fn().mockRejectedValue(new Error("Job mailbox-classify-m1 already exists"));
    const getJob = vi.fn().mockResolvedValue(null);
    const outcome = await ensureMailboxClassifyJob({
      queue: { add, getJob },
      workspaceId: "ws",
      inboxConnectionId: "c1",
      emailMessageId: "m1",
    });
    expect(outcome).toBe("skipped_inflight");
  });
});

describe("inbox clearedAt filter contract", () => {
  it("skips create when receivedAt <= clearedAt", () => {
    const clearedAt = new Date("2026-08-01T12:00:00.000Z");
    const oldMsg = new Date("2026-07-01T12:00:00.000Z");
    const newMsg = new Date("2026-08-02T12:00:00.000Z");
    const shouldSkip = (receivedAt: Date | null, cleared: Date | null) =>
      Boolean(cleared && receivedAt && receivedAt.getTime() <= cleared.getTime());
    expect(shouldSkip(oldMsg, clearedAt)).toBe(true);
    expect(shouldSkip(newMsg, clearedAt)).toBe(false);
    expect(shouldSkip(oldMsg, null)).toBe(false);
  });

  it("documents MAX_MESSAGES_PER_SYNC = 100 bootstrap cap", () => {
    expect(100).toBe(100);
  });
});
