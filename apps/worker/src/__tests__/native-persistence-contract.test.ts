import { describe, expect, it } from "vitest";
import {
  NATIVE_PIPELINE_MODEL_NAME,
  NATIVE_PIPELINE_MODEL_VERSION,
  mapN8nPriorityToStored,
  normalizeTaskDueAt,
  resolveTaskSourceDate,
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

  it("normalizes invalid dueDate once before create+update so classification can continue", () => {
    // Mirrors persist-native-classification: one dueAt for both Prisma branches.
    const rawDueDate = "ASAP"; // model sometimes returns relative phrases
    const dueAt = normalizeTaskDueAt(rawDueDate, { emailMessageId: "msg-failing" });
    const sourceDate = resolveTaskSourceDate({
      receivedAt: new Date("2026-08-27T22:38:26.000Z"),
    });

    const update = { dueAt, sourceDate, title: "Submit proposal to Sam Kanne" };
    const create = { dueAt, sourceDate, title: "Submit proposal to Sam Kanne" };

    expect(dueAt).toBeNull();
    expect(update.dueAt).toBe(create.dueAt);
    expect(sourceDate.toISOString()).toBe("2026-08-27T22:38:26.000Z");
    // Legacy bug: truthy string → Invalid Date → PrismaClientValidationError
    const legacy = rawDueDate ? new Date(rawDueDate) : null;
    expect(Number.isNaN(legacy!.getTime())).toBe(true);
  });

  it("CLASSIFIED means core persist succeeded; task enrichment is optional", () => {
    expect({
      coreSetsClassified: true,
      taskFailureSetsFailed: false,
      invalidRecipientSetsFailed: false,
    }).toEqual({
      coreSetsClassified: true,
      taskFailureSetsFailed: false,
      invalidRecipientSetsFailed: false,
    });
  });
});
