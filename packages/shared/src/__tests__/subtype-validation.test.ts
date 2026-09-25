import { describe, expect, it } from "vitest";

import {
  blindExpectedSubtype,
  BLIND_REVIEW_EVIDENCE_FIELDS,
  encodeSubtypeVerifyReason,
  evaluationLabelSource,
  parseSubtypeVerifyReason,
  scoreSubtypeShadow,
  selectSubtypeValidationSample,
  storedSubtypeVisible,
  validationProgress,
  type SubtypeSampleCandidate,
} from "../subtype-validation.js";

function row(
  id: string,
  subtype: string,
  extra: Partial<SubtypeSampleCandidate> = {}
): SubtypeSampleCandidate {
  return {
    classificationId: id,
    subtype,
    confidence: 0.9,
    competingType: null,
    bodyChars: 400,
    hasAttachments: false,
    hasThreadContext: false,
    alreadyVerified: false,
    ...extra,
  };
}

describe("subtype verification reasons", () => {
  it("keeps confirm and change on the existing correction reason", () => {
    expect(parseSubtypeVerifyReason(encodeSubtypeVerifyReason("confirm"))).toMatchObject({
      action: "confirm",
      category: null,
      source: "ANCHORED_VALIDATION",
    });
    expect(parseSubtypeVerifyReason(encodeSubtypeVerifyReason("change", "TAXONOMY_BOUNDARY"))).toMatchObject({
      action: "change",
      category: "TAXONOMY_BOUNDARY",
      source: "ANCHORED_VALIDATION",
    });
    expect(parseSubtypeVerifyReason("Please fix the job")).toBeNull();
  });

  it("stores an independent blind label and an ambiguous marker that is not a subtype", () => {
    expect(parseSubtypeVerifyReason(encodeSubtypeVerifyReason("blind"))).toMatchObject({
      action: "blind",
      source: "BLIND_VALIDATION",
    });
    expect(encodeSubtypeVerifyReason("ambiguous", "MISSING_THREAD")).toBe(
      "subtype-verify:ambiguous|MISSING_THREAD"
    );
    expect(blindExpectedSubtype("subtype-verify:blind", "RFI_CLARIFICATION")).toBe("RFI_CLARIFICATION");
    expect(blindExpectedSubtype("subtype-verify:ambiguous|MULTI_PURPOSE", null)).toBeNull();
    expect(blindExpectedSubtype("subtype-verify:confirm", "RFI_CLARIFICATION")).toBeNull();
    expect(evaluationLabelSource({
      reason: null,
      originalBusinessType: "SUBMITTAL_SHOP_DRAWING",
      correctedBusinessType: "FABRICATION_PRODUCTION",
    })).toBe("HISTORICAL_CORRECTION");
    expect(evaluationLabelSource({ reason: "subtype-verify:blind" })).toBe("BLIND_VALIDATION");
  });
});

describe("blind review visibility", () => {
  it("hides the stored subtype until a human label is submitted", () => {
    expect(storedSubtypeVisible("before-label")).toBe(false);
    expect(storedSubtypeVisible("after-label")).toBe(true);
    expect(BLIND_REVIEW_EVIDENCE_FIELDS).not.toContain("businessTypeKey");
    expect(BLIND_REVIEW_EVIDENCE_FIELDS).not.toContain("competingType");
    expect(validationProgress({ labeled: 30, ambiguous: 7, target: 200, remaining: 163 })).toEqual({
      reviewed: 37,
      labeled: 30,
      ambiguous: 7,
      target: 200,
      remaining: 163,
    });
  });
});

describe("subtype validation sample", () => {
  it("covers every present subtype and skips rows that already have a label", () => {
    const candidates = [
      row("verified", "RFI_CLARIFICATION", { alreadyVerified: true }),
      row("rfi", "RFI_CLARIFICATION", { confidence: 0.4 }),
      row("sub", "SUBMITTAL_SHOP_DRAWING", { confidence: 0.6, hasAttachments: true }),
      row("other", "OTHER_BUSINESS", { confidence: 0.2, bodyChars: 40 }),
      row("bid", "BID_OPPORTUNITY", { confidence: 0.95, hasThreadContext: true, bodyChars: 2000 }),
    ];
    const sample = selectSubtypeValidationSample(candidates, { target: 10, seed: 7 });
    expect(sample.classificationIds).not.toContain("verified");
    expect(sample.coverage.subtypes.map((item) => item.subtype).sort()).toEqual([
      "BID_OPPORTUNITY",
      "OTHER_BUSINESS",
      "RFI_CLARIFICATION",
      "SUBMITTAL_SHOP_DRAWING",
    ]);
    expect(sample.coverage.shortReplies).toBeGreaterThan(0);
    expect(sample.coverage.longMessages).toBeGreaterThan(0);
    expect(sample.coverage.withAttachments).toBeGreaterThan(0);
    expect(sample.coverage.withThread).toBeGreaterThan(0);
  });

  it("gives confusion-pair subtypes more seats than a one-off subtype", () => {
    const candidates: SubtypeSampleCandidate[] = [];
    for (let i = 0; i < 20; i += 1) {
      candidates.push(row(`bid-${i}`, "BID_OPPORTUNITY", { confidence: i % 3 === 0 ? 0.9 : 0.6 }));
      candidates.push(row(`est-${i}`, "ESTIMATE_QUOTE", { confidence: 0.7 }));
      candidates.push(row(`legal-${i}`, "COMPLIANCE_LEGAL", { confidence: 0.9 }));
    }
    const sample = selectSubtypeValidationSample(candidates, { target: 18, seed: 3 });
    const count = (subtype: string) =>
      sample.coverage.subtypes.find((item) => item.subtype === subtype)?.count ?? 0;
    expect(count("BID_OPPORTUNITY")).toBeGreaterThan(count("COMPLIANCE_LEGAL"));
    expect(count("ESTIMATE_QUOTE")).toBeGreaterThan(count("COMPLIANCE_LEGAL"));
    expect(count("COMPLIANCE_LEGAL")).toBeGreaterThan(0);
  });
});

describe("subtype shadow score", () => {
  it("reports calibration, confusion, and whether the expected type was the competitor", () => {
    const report = scoreSubtypeShadow([
      {
        classificationId: "a",
        expected: "SUBMITTAL_SHOP_DRAWING",
        predicted: "FABRICATION_PRODUCTION",
        confidence: 0.91,
        competingType: "SUBMITTAL_SHOP_DRAWING",
        inputChars: 1000,
      },
      {
        classificationId: "b",
        expected: "INVOICE_PAYMENT",
        predicted: "INVOICE_PAYMENT",
        confidence: 0.96,
        competingType: null,
        inputChars: 800,
      },
      {
        classificationId: "c",
        expected: "RFI_CLARIFICATION",
        predicted: "OTHER_BUSINESS",
        confidence: 0.4,
        competingType: null,
        inputChars: 600,
      },
    ]);
    expect(report.total).toBe(3);
    expect(report.correct).toBe(1);
    expect(report.accuracy).toBeCloseTo(1 / 3);
    expect(report.bands.find((band) => band.band === "HIGH")).toMatchObject({
      sampleCount: 2,
      correct: 1,
    });
    expect(report.bands.find((band) => band.band === "LOW")).toMatchObject({
      sampleCount: 1,
      correct: 0,
    });
    expect(report.confusion).toContainEqual({
      expected: "SUBMITTAL_SHOP_DRAWING",
      predicted: "FABRICATION_PRODUCTION",
      count: 1,
    });
    expect(report.competing).toEqual({
      wrongPrimary: 2,
      expectedWasCompeting: 1,
      percentage: 0.5,
    });
    expect(report.otherBusiness.predicted).toBe(1);
    expect(report.otherBusiness.whenPredictedHumanExpected).toEqual([
      { subtype: "RFI_CLARIFICATION", count: 1 },
    ]);
    expect(report.input.averageInputChars).toBe(800);
    expect(report.perSubtype.find((row) => row.subtype === "INVOICE_PAYMENT")?.recall).toBe(1);
  });

  it("returns null accuracy when nothing has been scored", () => {
    expect(scoreSubtypeShadow([]).accuracy).toBeNull();
    expect(scoreSubtypeShadow([]).competing.percentage).toBeNull();
    expect(scoreSubtypeShadow([]).humanAmbiguous).toBe(0);
  });

  it("excludes ambiguous human labels from accuracy and the confusion matrix", () => {
    const report = scoreSubtypeShadow([
      {
        classificationId: "ok",
        expected: "INVOICE_PAYMENT",
        predicted: "INVOICE_PAYMENT",
        confidence: 0.96,
        competingType: null,
      },
      {
        classificationId: "unsure",
        expected: "AMBIGUOUS",
        predicted: "PROJECT_COORDINATION",
        confidence: 0.4,
        competingType: null,
        ambiguous: true,
      },
    ]);
    expect(report.reviewed).toBe(2);
    expect(report.humanLabeled).toBe(1);
    expect(report.humanAmbiguous).toBe(1);
    expect(report.total).toBe(1);
    expect(report.accuracy).toBe(1);
    expect(report.confusion.map((row) => row.expected)).not.toContain("AMBIGUOUS");
  });
});
