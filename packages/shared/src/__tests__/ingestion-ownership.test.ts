import { describe, expect, it } from "vitest";
import {
  buildClassificationWriteLog,
  connectionIdFromScheduledSyncJobId,
  historicalImportJobId,
  isN8nOwnedClassification,
  scheduledInboxSyncJobId,
  shouldEnqueueNativeClassification,
  shouldRegisterNativePush,
  shouldScheduleNativeInboxSync,
  shouldRunNativeInboxSync,
  shouldRunProductionNativeClassification,
  shouldSkipNativeClassificationOverwrite,
} from "../ingestion-ownership.js";
import { buildMailboxClassifyJobId } from "../constants/queues.js";

describe("ingestion ownership", () => {
  it("schedules native sync only for ACTIVE NATIVE with listener ON", () => {
    expect(
      shouldScheduleNativeInboxSync({
        status: "ACTIVE",
        ingestionSource: "NATIVE",
        nativeListeningEnabled: true,
      })
    ).toBe(true);
    expect(
      shouldScheduleNativeInboxSync({
        status: "ACTIVE",
        ingestionSource: "NATIVE",
        nativeListeningEnabled: false,
      })
    ).toBe(false);
    expect(
      shouldScheduleNativeInboxSync({
        status: "ACTIVE",
        ingestionSource: "N8N",
        nativeListeningEnabled: true,
      })
    ).toBe(false);
    expect(
      shouldScheduleNativeInboxSync({
        status: "PAUSED",
        ingestionSource: "NATIVE",
        nativeListeningEnabled: true,
      })
    ).toBe(false);
  });

  it("OAuth alone (listening off) never schedules or runs native sync", () => {
    const afterOauth = {
      status: "ACTIVE",
      ingestionSource: "N8N",
      nativeListeningEnabled: false,
    };
    expect(shouldScheduleNativeInboxSync(afterOauth)).toBe(false);
    expect(shouldRunNativeInboxSync(afterOauth)).toBe(false);
    expect(shouldRegisterNativePush(afterOauth)).toBe(false);
    expect(shouldEnqueueNativeClassification(afterOauth)).toBe(false);
  });

  it("blocks native sync run when listener is OFF even for NATIVE mode", () => {
    expect(
      shouldRunNativeInboxSync({
        ingestionSource: "NATIVE",
        nativeListeningEnabled: false,
      })
    ).toBe(false);
    expect(
      shouldRunNativeInboxSync({
        ingestionSource: "NATIVE",
        nativeListeningEnabled: true,
      })
    ).toBe(true);
    expect(
      shouldRunNativeInboxSync({
        ingestionSource: "N8N",
        nativeListeningEnabled: true,
      })
    ).toBe(false);
  });

  it("enqueues native classification only for NATIVE processing mode", () => {
    expect(shouldEnqueueNativeClassification({ ingestionSource: "NATIVE" })).toBe(
      true
    );
    expect(shouldEnqueueNativeClassification({ ingestionSource: "N8N" })).toBe(
      false
    );
    expect(shouldEnqueueNativeClassification({ ingestionSource: "SHADOW" })).toBe(
      false
    );
  });

  it("detects n8n model names case-insensitively by prefix", () => {
    expect(isN8nOwnedClassification({ modelName: "n8n-openai" })).toBe(true);
    expect(isN8nOwnedClassification({ modelName: "N8N" })).toBe(true);
    expect(isN8nOwnedClassification({ modelName: "n8n-v2" })).toBe(true);
    expect(isN8nOwnedClassification({ modelName: "rules-normalizer" })).toBe(false);
    expect(isN8nOwnedClassification({ modelName: null })).toBe(false);
    expect(isN8nOwnedClassification(null)).toBe(false);
  });

  it("skips native overwrite for n8n-owned and manually reviewed classifications", () => {
    expect(
      shouldSkipNativeClassificationOverwrite({ modelName: "n8n-openai" })
    ).toBe(true);
    expect(
      shouldSkipNativeClassificationOverwrite({
        modelName: "rules-normalizer",
        reviewStatus: "APPROVED",
      })
    ).toBe(true);
    expect(
      shouldSkipNativeClassificationOverwrite({
        modelName: "rules-normalizer",
        reviewStatus: "REJECTED",
      })
    ).toBe(true);
    expect(
      shouldSkipNativeClassificationOverwrite({
        modelName: "rules-normalizer",
        reviewStatus: "PENDING",
      })
    ).toBe(false);
    expect(shouldSkipNativeClassificationOverwrite(null)).toBe(false);
  });

  it("builds safe classification write logs", () => {
    expect(
      buildClassificationWriteLog({
        workspaceId: "ws1",
        inboxConnectionId: "ic1",
        emailMessageId: "em1",
        source: "NATIVE_ANALYSIS",
        previousCategory: "BUSINESS",
        newCategory: "PERSONAL",
        modelName: "rules-normalizer",
      })
    ).toMatchObject({
      event: "email-classification-write",
      source: "NATIVE_ANALYSIS",
      previousCategory: "BUSINESS",
      newCategory: "PERSONAL",
    });
  });

  it("uses colon-free BullMQ-safe scheduled sync, historical import, and classify job ids", () => {
    expect(scheduledInboxSyncJobId("abc")).toBe("scheduled-sync-abc");
    expect(scheduledInboxSyncJobId("abc")).not.toContain(":");
    expect(historicalImportJobId("imp1")).toBe("historical-import-imp1");
    expect(historicalImportJobId("imp1")).not.toContain(":");
    expect(buildMailboxClassifyJobId("m1")).toBe("mailbox-classify-m1");
    expect(buildMailboxClassifyJobId("m1")).not.toContain(":");
    expect(
      shouldRunProductionNativeClassification({ ingestionSource: "NATIVE" })
    ).toBe(true);
  });

  it("parses connection id from current and legacy scheduled sync job ids", () => {
    expect(connectionIdFromScheduledSyncJobId("scheduled-sync-abc")).toBe("abc");
    expect(connectionIdFromScheduledSyncJobId("scheduled-sync:abc")).toBe("abc");
    expect(connectionIdFromScheduledSyncJobId("other")).toBeNull();
  });
});
