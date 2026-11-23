import { describe, expect, it } from "vitest";
import {
  compareJobIntelligenceLabRuns,
  getProductionJobIntelligenceModelId,
  getProductionJobMatchIdentityPolicy,
  isJobIntelligenceExecutableModelId,
  isJobMatchRunnablePolicyId,
  listEvaluationSelectablePolicies,
  listExecutableJobIntelligenceModels,
  resolveJobIntelligenceModelForExecution,
} from "../index.js";

describe("job intelligence model registry", () => {
  it("exposes only implemented executable models", () => {
    const models = listExecutableJobIntelligenceModels();
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models.every((m) => m.availableForExecution)).toBe(true);
    expect(isJobIntelligenceExecutableModelId("job-intel-extract-v1")).toBe(true);
    expect(isJobIntelligenceExecutableModelId("fake-model")).toBe(false);
  });

  it("resolves production default and rejects unknown models", () => {
    expect(getProductionJobIntelligenceModelId()).toBe("job-intel-extract-v1");
    const entry = resolveJobIntelligenceModelForExecution(null);
    expect(entry.id).toBe("job-intel-extract-v1");
    expect(() => resolveJobIntelligenceModelForExecution("does-not-exist")).toThrow(
      /Unknown/
    );
  });
});

describe("matcher vs intelligence independence", () => {
  it("keeps matcher and intelligence registries separate", () => {
    const matcherProd = getProductionJobMatchIdentityPolicy();
    const intelProd = getProductionJobIntelligenceModelId();
    expect(matcherProd).not.toBe(intelProd);
    expect(listEvaluationSelectablePolicies().every((p) => !p.retired)).toBe(true);
    expect(isJobMatchRunnablePolicyId("CONTEXT_AWARE_V3")).toBe(false);
  });
});

describe("lab compare", () => {
  it("diffs associations and fingerprints without inventing accuracy", () => {
    const comparison = compareJobIntelligenceLabRuns([
      {
        runId: "r1",
        label: "A",
        matcherModelId: "CONTEXT_AWARE_V2",
        intelligenceModelId: "job-intel-extract-v1",
        associationMode: "MATCHER_POLICY",
        associations: [
          {
            emailMessageId: "e1",
            jobId: "j1",
            source: "MATCHER_PREDICTION",
          },
          {
            emailMessageId: "e2",
            jobId: "j1",
            source: "HUMAN_AUTHORITATIVE",
          },
        ],
        events: [
          {
            category: "SCHEDULE",
            title: "Delivery",
            status: "CONFIRMED",
            contentFingerprint: "fp-a",
            evidenceCount: 1,
          },
          {
            category: "FINANCIAL",
            title: "Quote",
            status: "PROPOSED",
            financialKind: "QUOTE",
            amount: 1000,
            contentFingerprint: "fp-b",
            evidenceCount: 1,
          },
        ],
      },
      {
        runId: "r2",
        label: "B",
        matcherModelId: "CONTEXT_AWARE_V2_5",
        intelligenceModelId: "job-intel-extract-v1",
        associationMode: "MATCHER_POLICY",
        associations: [
          {
            emailMessageId: "e1",
            jobId: "j2",
            source: "MATCHER_PREDICTION",
          },
          {
            emailMessageId: "e2",
            jobId: "j1",
            source: "HUMAN_AUTHORITATIVE",
          },
        ],
        events: [
          {
            category: "SCHEDULE",
            title: "Delivery",
            status: "CONFIRMED",
            contentFingerprint: "fp-a",
            evidenceCount: 1,
          },
        ],
      },
    ]);

    expect(comparison.runs).toHaveLength(2);
    expect(comparison.associationDiffs.some((d) => d.emailMessageId === "e1")).toBe(
      true
    );
    expect(comparison.sharedEventFingerprints).toContain("fp-a");
    expect(comparison.eventFingerprintsOnlyIn.r1).toContain("fp-b");
    expect(comparison.notes.some((n) => n.includes("not automatically better"))).toBe(
      true
    );
  });
});
