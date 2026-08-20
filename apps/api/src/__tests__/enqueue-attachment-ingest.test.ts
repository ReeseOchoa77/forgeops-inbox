import { describe, expect, it, vi } from "vitest";
import { enqueueAttachmentIngestIfEligible } from "../application/services/enqueue-attachment-ingest.js";

describe("enqueueAttachmentIngestIfEligible", () => {
  it("does not enqueue when no OAuth refresh token (logs skip)", async () => {
    const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          provider: "OUTLOOK",
          encryptedRefreshToken: null,
        })),
      },
    };
    const queue = { add: vi.fn() };

    const outcome = await enqueueAttachmentIngestIfEligible({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      emailMessageId: "msg1",
      hasAttachments: true,
      bodyHtml: null,
      log: (event, data) => logs.push({ event, data }),
    });

    expect(outcome).toEqual({ enqueued: false, reason: "no_token" });
    expect(queue.add).not.toHaveBeenCalled();
    expect(logs.some((l) => l.event === "attachment-ingest-skipped")).toBe(true);
    expect(logs[0]?.data.reason).toBe("mailbox_not_oauth_connected");
  });

  it("enqueues when tokenized and HTML contains cid", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          provider: "OUTLOOK",
          encryptedRefreshToken: "enc-token",
        })),
      },
    };
    const queue = { add: vi.fn(async () => ({ id: "job1" })) };

    const outcome = await enqueueAttachmentIngestIfEligible({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      emailMessageId: "msg1",
      providerMessageId: "AAMk",
      hasAttachments: false,
      bodyHtml: `<img src="cid:image001.jpg@01DD28E1.71648A70">`,
    });

    expect(outcome.enqueued).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      "attachment-ingest",
      expect.objectContaining({
        workspaceId: "ws1",
        emailMessageId: "msg1",
        providerMessageId: "AAMk",
      }),
      expect.objectContaining({ jobId: "attachment-ingest-msg1" })
    );
  });

  it("skips inspect when no attachments and no cid", async () => {
    const queue = { add: vi.fn() };
    const outcome = await enqueueAttachmentIngestIfEligible({
      prisma: { inboxConnection: { findFirst: vi.fn() } } as never,
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      emailMessageId: "msg1",
      hasAttachments: false,
      bodyHtml: "<p>hi</p>",
    });
    expect(outcome).toEqual({ enqueued: false, reason: "no_inspect" });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("returns queue_unavailable when queue is missing", async () => {
    const outcome = await enqueueAttachmentIngestIfEligible({
      prisma: { inboxConnection: { findFirst: vi.fn() } } as never,
      queue: null,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      emailMessageId: "msg1",
      hasAttachments: true,
      bodyHtml: null,
    });
    expect(outcome).toEqual({ enqueued: false, reason: "queue_unavailable" });
  });

  it("uses colon-free deterministic jobId", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          provider: "OUTLOOK",
          encryptedRefreshToken: "enc-token",
        })),
      },
    };
    const queue = { add: vi.fn(async () => ({ id: "job1" })) };

    const outcome = await enqueueAttachmentIngestIfEligible({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      emailMessageId: "cmt1nfdq5003kjgoc8d8o7001",
      hasAttachments: true,
      bodyHtml: null,
    });

    expect(outcome).toEqual({
      enqueued: true,
      jobId: "attachment-ingest-cmt1nfdq5003kjgoc8d8o7001",
    });
    expect(queue.add).toHaveBeenCalledWith(
      "attachment-ingest",
      expect.any(Object),
      expect.objectContaining({
        jobId: "attachment-ingest-cmt1nfdq5003kjgoc8d8o7001",
      })
    );
  });

  it("treats duplicate jobId as enqueued success", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          provider: "OUTLOOK",
          encryptedRefreshToken: "enc-token",
        })),
      },
    };
    const queue = {
      add: vi.fn(async () => {
        throw new Error("Job attachment-ingest-msg1 already exists");
      }),
    };

    const outcome = await enqueueAttachmentIngestIfEligible({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      emailMessageId: "msg1",
      hasAttachments: true,
      bodyHtml: null,
    });

    expect(outcome).toEqual({
      enqueued: true,
      jobId: "attachment-ingest-msg1",
    });
  });
});
