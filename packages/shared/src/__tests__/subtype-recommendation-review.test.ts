import { describe, expect, it } from "vitest";
import {
  collectKnownSubtypeKeys,
  computeTaxonomyEvalMetrics,
  effectiveRecommendation,
  isValidSystemKey,
  suggestSystemKeyFromName,
  type SubtypeDiscoveryRecommendation,
} from "../subtype-discovery/index.js";

const baseRec = (): SubtypeDiscoveryRecommendation => ({
  id: "c001-new_subtype",
  clusterId: "c001",
  kind: "NEW_SUBTYPE",
  suggestedSubtypeName: "Material Certification",
  recommendedParentType: "BUSINESS",
  definition: "Certs",
  inclusionCriteria: "Includes cert",
  exclusionCriteria: "Not invoices",
  supportingEmailCount: 12,
  shareOfAnalyzed: 0.1,
  similarExistingSubtypes: [],
  overlapNotes: null,
  rationale: "Cluster",
  examples: [],
  clusterCohesion: 0.85,
});

describe("subtype recommendation review helpers", () => {
  it("suggests and validates system keys", () => {
    expect(suggestSystemKeyFromName("Material Certifications")).toBe(
      "MATERIAL_CERTIFICATIONS"
    );
    expect(isValidSystemKey("MATERIAL_CERTIFICATIONS")).toBe(true);
    expect(isValidSystemKey("bad-key")).toBe(false);
    expect(isValidSystemKey("1ABC")).toBe(false);
  });

  it("applies edits to effective recommendation", () => {
    const eff = effectiveRecommendation(baseRec(), {
      suggestedSubtypeName: "Shop Drawing Response",
      systemKey: "SHOP_DRAWING_RESPONSE",
      recommendedParentType: "BUSINESS",
      definition: "Responses to shop drawings",
      inclusionCriteria: "a",
      exclusionCriteria: "b",
    });
    expect(eff.suggestedSubtypeName).toBe("Shop Drawing Response");
    expect(eff.systemKey).toBe("SHOP_DRAWING_RESPONSE");
  });

  it("detects duplicates against system taxonomy", () => {
    const known = collectKnownSubtypeKeys(["CUSTOM_A"]);
    expect(known.has("RFI_CLARIFICATION")).toBe(true);
    expect(known.has("CUSTOM_A")).toBe(true);
    expect(known.has("BRAND_NEW")).toBe(false);
  });
});

describe("taxonomy before/after eval metrics", () => {
  it("reports descriptive coverage and GT precision only with labels", () => {
    const { metrics, emailChanges } = computeTaxonomyEvalMetrics([
      {
        emailMessageId: "1",
        currentKey: "OTHER_BUSINESS",
        groundTruthKey: "RFI_CLARIFICATION",
        proposedKey: "RFI_CLARIFICATION",
      },
      {
        emailMessageId: "2",
        currentKey: "PROJECT_COORDINATION",
        groundTruthKey: "PROJECT_COORDINATION",
        proposedKey: "PROJECT_COORDINATION",
      },
      {
        emailMessageId: "3",
        currentKey: null,
        groundTruthKey: null,
        proposedKey: "MATERIAL_CERTIFICATIONS",
      },
    ]);
    expect(metrics.current.coverage).toBeCloseTo(2 / 3, 3);
    expect(metrics.proposed.coverage).toBe(1);
    expect(metrics.current.groundTruthPrecision).toBe(0.5);
    expect(metrics.proposed.groundTruthPrecision).toBe(1);
    expect(metrics.delta.newlyMatchingGt).toBe(1);
    expect(metrics.delta.newlyMismatchingGt).toBe(0);
    expect(emailChanges.length).toBe(2);
    expect(metrics.groundTruthQuality).not.toBe("NONE");
    expect(metrics.methodologyNotes).toContain("never rewritten");
  });

  it("does not invent precision without GT", () => {
    const { metrics } = computeTaxonomyEvalMetrics([
      {
        emailMessageId: "a",
        currentKey: "OTHER_BUSINESS",
        groundTruthKey: null,
        proposedKey: "CUSTOM",
      },
    ]);
    expect(metrics.current.groundTruthPrecision).toBeNull();
    expect(metrics.proposed.groundTruthPrecision).toBeNull();
    expect(metrics.groundTruthQuality).toBe("NONE");
  });
});
