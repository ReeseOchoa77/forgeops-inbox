import { describe, expect, it } from "vitest";
import {
  canAutoRequeueClassification,
  MAX_AUTO_CLASSIFICATION_ATTEMPTS,
  truncateClassificationError,
} from "../classification-processing.js";

describe("classification-processing", () => {
  it("allows auto requeue under attempt cap", () => {
    expect(
      canAutoRequeueClassification({
        classificationAttemptCount: 2,
        classificationStatus: "PENDING",
      })
    ).toBe(true);
  });

  it("blocks FAILED and exhausted attempts", () => {
    expect(
      canAutoRequeueClassification({
        classificationAttemptCount: 0,
        classificationStatus: "FAILED",
      })
    ).toBe(false);
    expect(
      canAutoRequeueClassification({
        classificationAttemptCount: MAX_AUTO_CLASSIFICATION_ATTEMPTS,
        classificationStatus: "PROCESSING",
      })
    ).toBe(false);
  });

  it("truncates long errors", () => {
    expect(truncateClassificationError("  hello   world  ")).toBe("hello world");
  });
});
