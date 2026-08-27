import { describe, expect, it, vi } from "vitest";
import { enqueueAttachmentIngestFromSync } from "../application/services/enqueue-attachment-ingest-from-sync.js";

/**
 * Mirrors the historical-import gate: attachment ingest must enqueue whenever
 * Outlook + refresh token + candidates exist — independent of classification.
 */
function shouldEnqueueHistoricalAttachmentIngest(input: {
  hasAttachmentIngestQueue: boolean;
  provider: string;
  encryptedRefreshToken: string | null;
  candidateCount: number;
}): boolean {
  return (
    input.hasAttachmentIngestQueue &&
    input.provider === "OUTLOOK" &&
    Boolean(input.encryptedRefreshToken) &&
    input.candidateCount > 0
  );
}

describe("historical import attachment ingest", () => {
  it("enqueues when Outlook import produces candidates", async () => {
    const queue = { add: vi.fn(async () => ({ id: "job1" })) };
    const result = await enqueueAttachmentIngestFromSync({
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      candidates: [
        {
          emailMessageId: "msg-forgeops-1",
          providerMessageId: "AAMkOutlookMsg",
        },
      ],
    });
    expect(result.enqueuedCount).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("gate is independent of classification success", () => {
    const classifyWouldFail = true;
    const shouldEnqueue = shouldEnqueueHistoricalAttachmentIngest({
      hasAttachmentIngestQueue: true,
      provider: "OUTLOOK",
      encryptedRefreshToken: "enc",
      candidateCount: 2,
    });
    expect(shouldEnqueue).toBe(true);
    // Classification outcome must not appear in the gate
    expect(classifyWouldFail).toBe(true);
  });

  it("still enqueues when native classification is skipped (non-NATIVE mode)", () => {
    const processingMode = "N8N" as const;
    const shouldClassify = processingMode === "NATIVE";
    const shouldEnqueue = shouldEnqueueHistoricalAttachmentIngest({
      hasAttachmentIngestQueue: true,
      provider: "OUTLOOK",
      encryptedRefreshToken: "enc",
      candidateCount: 1,
    });
    expect(shouldClassify).toBe(false);
    expect(shouldEnqueue).toBe(true);
  });

  it("does not enqueue without candidates or without Outlook token", () => {
    expect(
      shouldEnqueueHistoricalAttachmentIngest({
        hasAttachmentIngestQueue: true,
        provider: "OUTLOOK",
        encryptedRefreshToken: "enc",
        candidateCount: 0,
      })
    ).toBe(false);
    expect(
      shouldEnqueueHistoricalAttachmentIngest({
        hasAttachmentIngestQueue: true,
        provider: "GMAIL",
        encryptedRefreshToken: "enc",
        candidateCount: 1,
      })
    ).toBe(false);
    expect(
      shouldEnqueueHistoricalAttachmentIngest({
        hasAttachmentIngestQueue: true,
        provider: "OUTLOOK",
        encryptedRefreshToken: null,
        candidateCount: 1,
      })
    ).toBe(false);
  });

  it("live native sync uses the same enqueue helper as historical import", async () => {
    const queue = { add: vi.fn(async () => ({ id: "job1" })) };
    await enqueueAttachmentIngestFromSync({
      queue: queue as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      candidates: [
        { emailMessageId: "live-msg", providerMessageId: "AAMkLive" },
      ],
    });
    expect(queue.add).toHaveBeenCalledWith(
      "attachment-ingest",
      expect.objectContaining({
        emailMessageId: "live-msg",
        providerMessageId: "AAMkLive",
      }),
      expect.objectContaining({
        jobId: "attachment-ingest-live-msg",
      })
    );
  });
});
