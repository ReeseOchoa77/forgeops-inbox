import { describe, expect, it } from "vitest";
import {
  buildClassificationWriteLog,
  isN8nOwnedClassification,
  scheduledInboxSyncJobId,
  shouldScheduleNativeInboxSync,
  shouldRunNativeInboxSync,
  shouldSkipNativeClassificationOverwrite,
} from "../ingestion-ownership.js";

describe("ingestion ownership", () => {
  it("schedules native sync only for ACTIVE NATIVE connections", () => {
    expect(
      shouldScheduleNativeInboxSync({ status: "ACTIVE", ingestionSource: "NATIVE" })
    ).toBe(true);
    expect(
      shouldScheduleNativeInboxSync({ status: "ACTIVE", ingestionSource: "N8N" })
    ).toBe(false);
    expect(
      shouldScheduleNativeInboxSync({ status: "PAUSED", ingestionSource: "NATIVE" })
    ).toBe(false);
  });

  it("blocks native sync run for N8N connections", () => {
    expect(shouldRunNativeInboxSync({ ingestionSource: "NATIVE" })).toBe(true);
    expect(shouldRunNativeInboxSync({ ingestionSource: "N8N" })).toBe(false);
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

  it("uses stable scheduled sync job ids", () => {
    expect(scheduledInboxSyncJobId("abc")).toBe("scheduled-sync:abc");
  });
});
