import { describe, expect, it } from "vitest";
import {
  NATIVE_PIPELINE_MODEL_NAME,
  NATIVE_PIPELINE_MODEL_VERSION,
  mapN8nPriorityToStored,
} from "@forgeops/shared";

/**
 * Documents persistence mapping for native production writes
 * (mirrors persistNativeClassificationResult decisions).
 */
describe("native persistence mapping contract", () => {
  it("uses native pipeline model identity, not rules-normalizer", () => {
    expect(NATIVE_PIPELINE_MODEL_NAME).toBe("native-openai-pipeline");
    expect(NATIVE_PIPELINE_MODEL_VERSION).toBe("v1");
    expect(NATIVE_PIPELINE_MODEL_NAME).not.toContain("rules-normalizer");
  });

  it("maps deterministic n8n priority vocabulary to stored enum", () => {
    expect(mapN8nPriorityToStored("NORMAL")).toBe("MEDIUM");
    expect(mapN8nPriorityToStored("HIGH")).toBe("HIGH");
    expect(mapN8nPriorityToStored("URGENT")).toBe("URGENT");
    expect(mapN8nPriorityToStored("LOW")).toBe("LOW");
  });

  it("documents job assignment source-of-truth", () => {
    const rule = {
      aiSelectedJobId: "hint-only-in-rawAiPayload",
      classificationJobId: "JobMatcherService",
      emailMessageJobId: "JobMatcherService",
      aiCustomerVendor: "entity-selection model → Classification columns",
    };
    expect(rule.classificationJobId).toBe("JobMatcherService");
    expect(rule.aiSelectedJobId).toContain("hint");
  });
});
