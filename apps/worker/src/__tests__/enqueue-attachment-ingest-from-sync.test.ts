import { describe, expect, it, vi } from "vitest";
import { enqueueAttachmentIngestFromSync } from "../application/services/enqueue-attachment-ingest-from-sync.js";

describe("enqueueAttachmentIngestFromSync", () => {
  it("enqueues with colon-free deterministic jobId", async () => {
    const queue = { add: vi.fn(async () => ({ id: "job1" })) };

    const result = await enqueueAttachmentIngestFromSync({
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      candidates: [
        {
          emailMessageId: "cmt1nfdq5003kjgoc8d8o7001",
          providerMessageId: "AAMk",
        },
      ],
    });

    expect(result).toEqual({ enqueuedCount: 1, failedCount: 0 });
    expect(queue.add).toHaveBeenCalledWith(
      "attachment-ingest",
      expect.objectContaining({
        emailMessageId: "cmt1nfdq5003kjgoc8d8o7001",
        providerMessageId: "AAMk",
      }),
      expect.objectContaining({
        jobId: "attachment-ingest-cmt1nfdq5003kjgoc8d8o7001",
      })
    );
    expect("attachment-ingest-cmt1nfdq5003kjgoc8d8o7001").not.toContain(":");
  });

  it("treats duplicate jobId as successful enqueue", async () => {
    const queue = {
      add: vi.fn(async () => {
        throw new Error(
          "Job attachment-ingest-cmt1nfdq5003kjgoc8d8o7001 already exists"
        );
      }),
    };

    const result = await enqueueAttachmentIngestFromSync({
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      candidates: [
        {
          emailMessageId: "cmt1nfdq5003kjgoc8d8o7001",
          providerMessageId: "AAMk",
        },
      ],
    });

    expect(result).toEqual({ enqueuedCount: 1, failedCount: 0 });
  });

  it("counts only successful enqueues when add fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const queue = {
      add: vi.fn(async () => {
        throw new Error("Custom Id cannot contain :");
      }),
    };

    const result = await enqueueAttachmentIngestFromSync({
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      candidates: [
        {
          emailMessageId: "msg1",
          providerMessageId: "AAMk1",
        },
        {
          emailMessageId: "msg2",
          providerMessageId: "AAMk2",
        },
      ],
    });

    expect(result).toEqual({ enqueuedCount: 0, failedCount: 2 });
    warn.mockRestore();
  });
});
