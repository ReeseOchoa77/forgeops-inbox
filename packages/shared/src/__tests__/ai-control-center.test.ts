import { describe, expect, it } from "vitest";
import {
  defaultAiControlSubsystemStates,
  listAiControlSubsystemDefinitions,
  mergeAiControlStates,
  validateAiControlPatch,
  validateSubsystemModel,
} from "../ai-control/index.js";
import { getProductionJobMatchIdentityPolicy } from "../jobs/job-match-policy-registry.js";
import { getProductionJobIntelligenceModelId } from "../jobs/job-intelligence/model-registry.js";

describe("AI Control Center catalog", () => {
  it("exposes only real subsystems with selectable non-retired models", () => {
    const defs = listAiControlSubsystemDefinitions();
    const ids = defs.map((d) => d.id);
    expect(ids).toEqual([
      "job-matcher",
      "job-intelligence",
      "email-classification",
      "inline-image-relevance",
      "bid-analysis",
    ]);
    for (const def of defs) {
      expect(def.models.some((m) => m.selectable && m.status !== "retired")).toBe(
        true
      );
      expect(def.models.every((m) => m.status !== "retired" || !m.selectable)).toBe(
        true
      );
    }
    expect(
      defs
        .find((d) => d.id === "job-matcher")
        ?.models.some((m) => m.id === "CONTEXT_AWARE_V3")
    ).toBe(false);
  });

  it("defaults preserve production freeze for matcher and inline image", () => {
    const defaults = defaultAiControlSubsystemStates();
    expect(defaults["job-matcher"].productionModelId).toBe(
      getProductionJobMatchIdentityPolicy()
    );
    expect(defaults["job-intelligence"].productionModelId).toBe(
      getProductionJobIntelligenceModelId()
    );
    expect(defaults["email-classification"].enabled).toBe(true);
    expect(defaults["job-intelligence"].enabled).toBe(true);
    expect(defaults["bid-analysis"].enabled).toBe(true);
  });

  it("merge overlays stored values without inventing unknown subsystems", () => {
    const merged = mergeAiControlStates({
      "job-matcher": {
        enabled: true,
        productionModelId: "CONTEXT_AWARE_V2_5",
      },
      "not-a-real-system": { enabled: false, productionModelId: "x" },
    });
    expect(merged["job-matcher"].enabled).toBe(true);
    expect(merged["job-matcher"].productionModelId).toBe("CONTEXT_AWARE_V2_5");
    expect(merged["email-classification"].enabled).toBe(true);
  });

  it("rejects retired matcher V3 for production selection", () => {
    const err = validateSubsystemModel("job-matcher", "CONTEXT_AWARE_V3");
    expect(err).not.toBeNull();
    const patch = validateAiControlPatch({
      "job-matcher": {
        enabled: true,
        productionModelId: "CONTEXT_AWARE_V3",
      },
    });
    expect(patch.ok).toBe(false);
  });

  it("accepts runnable matcher policy switches", () => {
    const patch = validateAiControlPatch({
      "job-matcher": {
        enabled: true,
        productionModelId: "CONTEXT_AWARE_V2_5",
      },
    });
    expect(patch.ok).toBe(true);
    if (patch.ok) {
      expect(patch.next["job-matcher"].productionModelId).toBe(
        "CONTEXT_AWARE_V2_5"
      );
      expect(patch.next["job-matcher"].enabled).toBe(true);
    }
  });
});
