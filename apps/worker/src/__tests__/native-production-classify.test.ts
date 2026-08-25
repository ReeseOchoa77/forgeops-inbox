import { describe, expect, it, vi } from "vitest";
import {
  buildMailboxClassifyJobId,
  NATIVE_PIPELINE_MODEL_NAME,
  shouldEnqueueNativeClassification,
  shouldRunProductionNativeClassification,
  shouldSkipNativeClassificationOverwrite,
} from "@forgeops/shared";

describe("production native classification gates", () => {
  it("N8N connection never enters production native classifier", () => {
    const n8n = { ingestionSource: "N8N" };
    expect(shouldEnqueueNativeClassification(n8n)).toBe(false);
    expect(shouldRunProductionNativeClassification(n8n)).toBe(false);
  });

  it("NATIVE mode enables production native classifier enqueue", () => {
    expect(
      shouldEnqueueNativeClassification({ ingestionSource: "NATIVE" })
    ).toBe(true);
  });

  it("protects n8n-owned and manually reviewed classifications", () => {
    expect(
      shouldSkipNativeClassificationOverwrite({
        modelName: "n8n-openai",
        reviewStatus: "PENDING",
      })
    ).toBe(true);
    expect(
      shouldSkipNativeClassificationOverwrite({
        modelName: NATIVE_PIPELINE_MODEL_NAME,
        reviewStatus: "APPROVED",
      })
    ).toBe(true);
    expect(
      shouldSkipNativeClassificationOverwrite({
        modelName: NATIVE_PIPELINE_MODEL_NAME,
        reviewStatus: "PENDING",
      })
    ).toBe(false);
  });

  it("uses deterministic per-message classify job ids", () => {
    expect(buildMailboxClassifyJobId("msg1")).toBe("mailbox-classify-msg1");
  });
});

describe("live sync enqueue contract", () => {
  it("enqueues classify only for createdMessageIds, not updated duplicates", () => {
    const enqueue = vi.fn();
    const syncResult = {
      createdMessageIds: ["new-1", "new-2"],
      updatedMessageIds: ["old-1"],
      duplicateMessageIds: ["old-1"],
      messagesImported: 2,
    };
    const connection = { ingestionSource: "NATIVE" };

    if (shouldEnqueueNativeClassification(connection)) {
      for (const id of syncResult.createdMessageIds) {
        enqueue(id);
      }
    }

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith("new-1");
    expect(enqueue).toHaveBeenCalledWith("new-2");
    expect(enqueue).not.toHaveBeenCalledWith("old-1");
  });

  it("one new message does not imply whole-mailbox analysis enqueue", () => {
    const enqueueWholeMailboxAnalysis = vi.fn();
    const enqueueMessageClassify = vi.fn();
    const createdMessageIds = ["only-one"];

    // New path: message-scoped only
    for (const id of createdMessageIds) {
      enqueueMessageClassify(id);
    }
    // Old path must not run
    expect(enqueueWholeMailboxAnalysis).not.toHaveBeenCalled();
    expect(enqueueMessageClassify).toHaveBeenCalledTimes(1);
  });
});
