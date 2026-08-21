import { describe, expect, it } from "vitest";

import {
  buildClassificationEvidenceViewModel,
  detectEvidenceFormat,
  extractN8nReviewReasons,
  isLegacyWeightedEvidence,
  isNewFlagEvidence,
  mergeClassificationEvidenceForPersist,
} from "../reference/classification-evidence-display.js";

function newEvidence(overrides: Record<string, unknown> = {}) {
  return {
    content: {
      probability: 0.5,
      strongFlag: false,
      explanation: "content",
    },
    sender: {
      status: "UNKNOWN",
      confidence: null,
      cumulativeAdjustment: 0,
    },
    signature: {
      probability: 0,
      includedInDecision: false,
      explanation: "excluded",
    },
    job: {
      probability: 0.5,
      strongFlag: false,
      explanation: "job",
    },
    subject: {
      probability: 0.5,
      strongFlag: false,
      explanation: "subject",
    },
    decisionRule: "CUMULATIVE_PERSONAL",
    cumulativeBusinessScore: 112,
    cumulativeBusinessThreshold: 150,
    ...overrides,
  };
}

describe("classification evidence format detection", () => {
  it("detects legacy weighted evidence", () => {
    const legacy = {
      content: { probability: 0.9, weight: 0.4, contribution: 0.36, explanation: "x" },
      sender: { probability: 0.5, weight: 0.25, contribution: 0.125 },
      signature: { probability: 0.1, weight: 0.15, contribution: 0.015, explanation: "x" },
      job: { probability: 0.2, weight: 0.15, contribution: 0.03, explanation: "x" },
      subject: { probability: 0.8, weight: 0.05, contribution: 0.04, explanation: "x" },
      finalBusinessProbability: 0.57,
    };
    expect(detectEvidenceFormat(legacy)).toBe("legacy_weighted");
    expect(isLegacyWeightedEvidence(legacy)).toBe(true);
    expect(isNewFlagEvidence(legacy)).toBe(false);
  });

  it("detects new flag evidence", () => {
    const evidence = newEvidence({ decisionRule: "STRONG_BUSINESS_FLAG" });
    expect(detectEvidenceFormat(evidence)).toBe("new_flags");
    expect(isNewFlagEvidence(evidence)).toBe(true);
  });
});

describe("new classification evidence view model", () => {
  it("1. CONFIRMED_BUSINESS sender", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "CONFIRMED_BUSINESS_SENDER",
        sender: { status: "CONFIRMED_BUSINESS", cumulativeAdjustment: 0 },
        classificationDecision: { rule: "CONFIRMED_BUSINESS_SENDER" },
      }),
      "BUSINESS"
    );
    expect(vm?.showConfirmedSenderBanner).toBe(true);
    expect(vm?.showCumulativeBreakdown).toBe(false);
    expect(vm?.decisionTitle).toMatch(/confirmed business/i);
    expect(vm?.decisionSummary).toMatch(/Business classification/i);
    expect(vm?.confidenceLabel).toBe("Classification confidence");
  });

  it("2. CONFIRMED_PERSONAL sender", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "CONFIRMED_PERSONAL_SENDER",
        sender: { status: "CONFIRMED_PERSONAL", cumulativeAdjustment: 0 },
      }),
      "PERSONAL"
    );
    expect(vm?.showConfirmedSenderBanner).toBe(true);
    expect(vm?.showCumulativeBreakdown).toBe(false);
    expect(vm?.decisionSummary).toMatch(/Personal classification/i);
  });

  it("3. single content flag >= 80", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "STRONG_BUSINESS_FLAG",
        content: { probability: 0.85, strongFlag: true, explanation: "c" },
        subject: { probability: 0.2, strongFlag: false, explanation: "s" },
        job: { probability: 0.1, strongFlag: false, explanation: "j" },
        classificationDecision: {
          rule: "STRONG_BUSINESS_FLAG",
          flags: { contentBusiness: true, subjectBusiness: false, jobBusiness: false },
        },
      }),
      "BUSINESS"
    );
    expect(vm?.showStrongSignals).toBe(true);
    expect(vm?.showCumulativeBreakdown).toBe(false);
    expect(vm?.signals.find((s) => s.key === "content")?.strongFlag).toBe(true);
    expect(vm?.decisionSummary).toMatch(/Content/i);
  });

  it("4. single subject flag >= 80", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "STRONG_BUSINESS_FLAG",
        content: { probability: 0.1, strongFlag: false, explanation: "c" },
        subject: { probability: 0.9, strongFlag: true, explanation: "s" },
        job: { probability: 0.1, strongFlag: false, explanation: "j" },
      }),
      "BUSINESS"
    );
    expect(vm?.signals.find((s) => s.key === "subject")?.strongFlag).toBe(true);
    expect(vm?.decisionSummary).toMatch(/Subject/i);
  });

  it("5. single job flag >= 80", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "STRONG_BUSINESS_FLAG",
        content: { probability: 0.1, strongFlag: false, explanation: "c" },
        subject: { probability: 0.1, strongFlag: false, explanation: "s" },
        job: { probability: 0.88, strongFlag: true, explanation: "j" },
      }),
      "BUSINESS"
    );
    expect(vm?.signals.find((s) => s.key === "job")?.strongFlag).toBe(true);
    expect(vm?.decisionSummary).toMatch(/Job/i);
  });

  it("6. cumulative score >= 150", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "CUMULATIVE_BUSINESS_THRESHOLD",
        cumulativeBusinessScore: 166,
        cumulativeBusinessThreshold: 150,
        classificationDecision: {
          rule: "CUMULATIVE_BUSINESS_THRESHOLD",
          cumulative: {
            contentPoints: 62,
            subjectPoints: 48,
            jobPoints: 31,
            senderAdjustment: 25,
            total: 166,
            threshold: 150,
          },
        },
      }),
      "BUSINESS"
    );
    expect(vm?.showCumulativeBreakdown).toBe(true);
    expect(vm?.cumulative?.total).toBe(166);
    expect(vm?.cumulative?.threshold).toBe(150);
    expect(vm?.decisionSummary).not.toMatch(/%/);
    expect(String(vm?.cumulative?.total)).not.toMatch(/%/);
  });

  it("7. cumulative score below 150", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "CUMULATIVE_PERSONAL",
        cumulativeBusinessScore: 112,
        cumulativeBusinessThreshold: 150,
        classificationDecision: {
          rule: "CUMULATIVE_PERSONAL",
          cumulative: {
            contentPoints: 40,
            subjectPoints: 40,
            jobPoints: 32,
            senderAdjustment: 0,
            total: 112,
            threshold: 150,
          },
        },
      }),
      "PERSONAL"
    );
    expect(vm?.showCumulativeBreakdown).toBe(true);
    expect(vm?.cumulative?.total).toBe(112);
    expect(vm?.decisionSummary).toMatch(/Personal/i);
  });

  it("8. likely-business sender +25", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "CUMULATIVE_BUSINESS_THRESHOLD",
        sender: {
          status: "LIKELY_BUSINESS",
          cumulativeAdjustment: 25,
        },
        classificationDecision: {
          rule: "CUMULATIVE_BUSINESS_THRESHOLD",
          cumulative: {
            contentPoints: 50,
            subjectPoints: 50,
            jobPoints: 50,
            senderAdjustment: 25,
            total: 175,
            threshold: 150,
          },
        },
      }),
      "BUSINESS"
    );
    expect(vm?.cumulative?.senderAdjustment).toBe(25);
    expect(vm?.signals.find((s) => s.key === "sender")?.status).toBe(
      "LIKELY_BUSINESS"
    );
  });

  it("9. likely-personal sender -25", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "CUMULATIVE_PERSONAL",
        sender: {
          status: "LIKELY_PERSONAL",
          cumulativeAdjustment: -25,
        },
        classificationDecision: {
          rule: "CUMULATIVE_PERSONAL",
          cumulative: {
            contentPoints: 50,
            subjectPoints: 50,
            jobPoints: 30,
            senderAdjustment: -25,
            total: 105,
            threshold: 150,
          },
        },
      }),
      "PERSONAL"
    );
    expect(vm?.cumulative?.senderAdjustment).toBe(-25);
  });

  it("10. unknown sender = 0", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "CUMULATIVE_PERSONAL",
        sender: { status: "UNKNOWN", cumulativeAdjustment: 0 },
        classificationDecision: {
          rule: "CUMULATIVE_PERSONAL",
          cumulative: {
            contentPoints: 40,
            subjectPoints: 40,
            jobPoints: 32,
            senderAdjustment: 0,
            total: 112,
            threshold: 150,
          },
        },
      }),
      "PERSONAL"
    );
    expect(vm?.cumulative?.senderAdjustment).toBe(0);
    expect(vm?.signals.find((s) => s.key === "sender")?.status).toBe("UNKNOWN");
  });

  it("11. all-three override of confirmed personal", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "ALL_THREE_BUSINESS_FLAGS_OVERRIDE_CONFIRMED_PERSONAL",
        content: { probability: 0.95, strongFlag: true, explanation: "c" },
        subject: { probability: 0.92, strongFlag: true, explanation: "s" },
        job: { probability: 0.9, strongFlag: true, explanation: "j" },
        sender: { status: "CONFIRMED_PERSONAL", cumulativeAdjustment: 0 },
      }),
      "BUSINESS"
    );
    expect(vm?.showOverrideBanner).toBe(true);
    expect(vm?.requiresReviewHint).toBe(true);
    expect(vm?.showCumulativeBreakdown).toBe(false);
    expect(vm?.decisionTitle).toMatch(/overridden/i);
  });

  it("12. signature marked includedInDecision=false", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "STRONG_BUSINESS_FLAG",
        signature: {
          probability: 0.9,
          includedInDecision: false,
          explanation: "excluded",
        },
      }),
      "BUSINESS"
    );
    expect(vm?.signals.find((s) => s.key === "signature")?.includedInDecision).toBe(
      false
    );
  });

  it("13. legacy weighted classification still renders", () => {
    const legacy = {
      content: { probability: 0.9, weight: 0.4, contribution: 0.36, explanation: "c" },
      sender: { probability: 0.5, weight: 0.25, contribution: 0.125, status: "UNKNOWN" },
      signature: { probability: 0.1, weight: 0.15, contribution: 0.015, explanation: "s" },
      job: { probability: 0.2, weight: 0.15, contribution: 0.03, explanation: "j" },
      subject: { probability: 0.8, weight: 0.05, contribution: 0.04, explanation: "subj" },
      finalBusinessProbability: 0.57,
    };
    const vm = buildClassificationEvidenceViewModel(legacy, "BUSINESS");
    expect(vm?.format).toBe("legacy_weighted");
    expect(vm?.legacyFinalBusinessProbability).toBe(0.57);
    expect(vm?.confidenceLabel).toBe("Final Business Probability");
    expect(vm?.signals).toHaveLength(5);
  });

  it("14. new classifications do not display old weights conceptually", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({ decisionRule: "STRONG_BUSINESS_FLAG" }),
      "BUSINESS"
    );
    expect(vm?.format).toBe("new_flags");
    expect(vm?.legacyFinalBusinessProbability).toBeNull();
    expect(vm?.confidenceLabel).not.toBe("Final Business Probability");
    // view model has no weight/contribution fields
    expect(vm?.signals.every((s) => !("weight" in s))).toBe(true);
  });

  it("15. cumulative score is not a percentage/probability", () => {
    const vm = buildClassificationEvidenceViewModel(
      newEvidence({
        decisionRule: "CUMULATIVE_BUSINESS_THRESHOLD",
        cumulativeBusinessScore: 165,
        cumulativeBusinessThreshold: 150,
        classificationDecision: {
          rule: "CUMULATIVE_BUSINESS_THRESHOLD",
          cumulative: { total: 165, threshold: 150 },
        },
      }),
      "BUSINESS"
    );
    expect(vm?.cumulative?.total).toBe(165);
    expect(vm?.cumulative?.threshold).toBe(150);
    expect(vm?.decisionTitle.toLowerCase()).toMatch(/cumulative|evidence/);
    expect(vm?.confidenceLabel).toBe("Classification confidence");
    // Must not treat 165 as 165% probability
    expect(vm?.legacyFinalBusinessProbability).toBeNull();
  });
});

describe("persist merge + review reasons", () => {
  it("merges classificationDecision into evidence for persistence", () => {
    const merged = mergeClassificationEvidenceForPersist({
      classificationEvidence: {
        content: { probability: 0.9, strongFlag: true },
      },
      classificationDecision: {
        rule: "STRONG_BUSINESS_FLAG",
        cumulative: { total: 200, threshold: 150 },
      },
    });
    expect(merged?.decisionRule).toBe("STRONG_BUSINESS_FLAG");
    expect(merged?.cumulativeBusinessScore).toBe(200);
    expect(merged?.classificationDecision).toMatchObject({
      rule: "STRONG_BUSINESS_FLAG",
    });
  });

  it("extracts n8n reviewReasons from routingHints", () => {
    expect(
      extractN8nReviewReasons({
        source: "n8n",
        reviewReasons: [
          "Candidate lookup failed",
          "Cumulative business decision is near threshold",
        ],
      })
    ).toEqual([
      "Candidate lookup failed",
      "Cumulative business decision is near threshold",
    ]);
  });
});
