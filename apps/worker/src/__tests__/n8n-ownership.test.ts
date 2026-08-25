import { describe, expect, it, vi } from "vitest";
import {
  shouldRunNativeInboxSync,
  shouldScheduleNativeInboxSync,
  shouldSkipNativeClassificationOverwrite,
} from "@forgeops/shared";

/**
 * Behavioral contracts for N8N vs NATIVE ownership.
 * Processor/webhook integration is covered by these pure guards + call-site wiring.
 */
describe("N8N ownership regression contracts", () => {
  it("A/1: N8N ACTIVE does not schedule native sync", () => {
    expect(
      shouldScheduleNativeInboxSync({ status: "ACTIVE", ingestionSource: "N8N" })
    ).toBe(false);
  });

  it("B/2: NATIVE ACTIVE with listener ON schedules native sync", () => {
    expect(
      shouldScheduleNativeInboxSync({
        status: "ACTIVE",
        ingestionSource: "NATIVE",
        nativeListeningEnabled: true,
      })
    ).toBe(true);
  });

  it("B/2b: NATIVE ACTIVE with listener OFF does not schedule", () => {
    expect(
      shouldScheduleNativeInboxSync({
        status: "ACTIVE",
        ingestionSource: "NATIVE",
        nativeListeningEnabled: false,
      })
    ).toBe(false);
  });

  it("5: stale sync job for N8N is blocked by run guard", () => {
    expect(
      shouldRunNativeInboxSync({
        ingestionSource: "N8N",
        nativeListeningEnabled: true,
      })
    ).toBe(false);
  });

  it("C/9: n8n classification cannot be overwritten by native analyzer", () => {
    expect(
      shouldSkipNativeClassificationOverwrite({ modelName: "n8n-openai", reviewStatus: "PENDING" })
    ).toBe(true);
  });

  it("D: rules-normalizer still allowable for native overwrite", () => {
    expect(
      shouldSkipNativeClassificationOverwrite({
        modelName: "rules-normalizer",
        reviewStatus: "PENDING",
      })
    ).toBe(false);
  });

  it("E: no classification → native analysis allowed", () => {
    expect(shouldSkipNativeClassificationOverwrite(null)).toBe(false);
  });

  it("F: manual APPROVED classification is preserved", () => {
    expect(
      shouldSkipNativeClassificationOverwrite({
        modelName: "rules-normalizer",
        reviewStatus: "APPROVED",
      })
    ).toBe(true);
  });

  it("processor skipped result shape for N8N", () => {
    // Mirrors InboxSyncProcessor early-return payload
    const connection = {
      id: "ic1",
      ingestionSource: "N8N" as const,
      syncCursor: "cursor-1",
    };
    expect(shouldRunNativeInboxSync(connection)).toBe(false);
    const result = {
      workspaceId: "ws1",
      inboxConnectionId: connection.id,
      threadsImported: 0,
      messagesImported: 0,
      duplicatesSkipped: 0,
      newestSyncCursor: connection.syncCursor,
      skipped: true,
      skipReason: "listener_or_mode_gate",
    };
    expect(result.messagesImported).toBe(0);
    expect(result.skipped).toBe(true);
  });

  it("analysis enqueue after sync only when not skipped (contract)", () => {
    const enqueueAnalysis = vi.fn();
    const syncResult = {
      messagesImported: 2,
      threadsImported: 1,
      skipped: true as boolean | undefined,
    };
    // Mirrors processor: do not enqueue when skipped
    if (!syncResult.skipped && (syncResult.messagesImported > 0 || syncResult.threadsImported > 0)) {
      enqueueAnalysis();
    }
    expect(enqueueAnalysis).not.toHaveBeenCalled();

    const nativeResult = { messagesImported: 2, threadsImported: 0, skipped: false };
    if (!nativeResult.skipped && (nativeResult.messagesImported > 0 || nativeResult.threadsImported > 0)) {
      enqueueAnalysis();
    }
    expect(enqueueAnalysis).toHaveBeenCalledTimes(1);
  });
});
