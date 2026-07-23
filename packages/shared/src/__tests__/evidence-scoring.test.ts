import { describe, it, expect } from "vitest";
import { calculateBusinessProbability, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from "../reference/evidence-scoring.js";

describe("evidence-based classification scoring", () => {
  it("confirmed business sender with strong content → BUSINESS", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.9,
      subjectBusinessProbability: 0.8,
      signatureCompanyMatchConfidence: 0.7,
      jobReferenceConfidence: 0.5,
      senderStatus: "CONFIRMED_BUSINESS",
      senderConfidence: 1.0,
      senderBusinessCount: 10,
      senderPersonalCount: 0
    });
    expect(result.classification).toBe("BUSINESS");
    expect(result.requiresReview).toBe(false);
    expect(result.finalBusinessProbability).toBeGreaterThan(0.80);
    expect(result.sender.probability).toBe(0.98);
  });

  it("unknown sender with strong business content → BUSINESS", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.98,
      subjectBusinessProbability: 0.95,
      signatureCompanyMatchConfidence: 0.95,
      jobReferenceConfidence: 0.95,
      senderStatus: null,
      senderBusinessCount: 0,
      senderPersonalCount: 0
    });
    expect(result.finalBusinessProbability).toBeGreaterThan(0.80);
    expect(result.sender.probability).toBe(0.50);
    expect(result.sender.explanation).toContain("First-time");
  });

  it("confirmed personal sender with weak content → PERSONAL", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.1,
      subjectBusinessProbability: 0.1,
      signatureCompanyMatchConfidence: 0,
      jobReferenceConfidence: 0,
      senderStatus: "CONFIRMED_PERSONAL",
      senderConfidence: 1.0,
      senderBusinessCount: 0,
      senderPersonalCount: 5
    });
    expect(result.classification).toBe("PERSONAL");
    expect(result.requiresReview).toBe(false);
    expect(result.finalBusinessProbability).toBeLessThan(0.20);
  });

  it("recognized job name boosts toward BUSINESS", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.5,
      subjectBusinessProbability: 0.5,
      signatureCompanyMatchConfidence: 0,
      jobReferenceConfidence: 0.95,
      senderStatus: null,
      senderBusinessCount: 0,
      senderPersonalCount: 0
    });
    expect(result.job.contribution).toBeGreaterThan(0.10);
    expect(result.finalBusinessProbability).toBeGreaterThan(0.40);
  });

  it("recognized customer signature boosts toward BUSINESS", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.5,
      subjectBusinessProbability: 0.5,
      signatureCompanyMatchConfidence: 0.95,
      jobReferenceConfidence: 0,
      senderStatus: null,
      senderBusinessCount: 0,
      senderPersonalCount: 0
    });
    expect(result.signature.contribution).toBeGreaterThan(0.10);
  });

  it("ambiguous email → requires review", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.5,
      subjectBusinessProbability: 0.5,
      signatureCompanyMatchConfidence: 0,
      jobReferenceConfidence: 0,
      senderStatus: null,
      senderBusinessCount: 0,
      senderPersonalCount: 0
    });
    expect(result.classification).toBe("REVIEW");
    expect(result.requiresReview).toBe(true);
    expect(result.finalBusinessProbability).toBeGreaterThan(0.20);
    expect(result.finalBusinessProbability).toBeLessThan(0.85);
  });

  it("conflicting evidence → requires review", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.9,
      subjectBusinessProbability: 0.9,
      signatureCompanyMatchConfidence: 0,
      jobReferenceConfidence: 0,
      senderStatus: "CONFIRMED_PERSONAL",
      senderConfidence: 1.0,
      senderBusinessCount: 0,
      senderPersonalCount: 10
    });
    expect(result.finalBusinessProbability).toBeGreaterThan(0.20);
    expect(result.finalBusinessProbability).toBeLessThan(0.85);
  });

  it("weights sum to approximately 1.0", () => {
    const sum = DEFAULT_WEIGHTS.content + DEFAULT_WEIGHTS.sender + DEFAULT_WEIGHTS.signature + DEFAULT_WEIGHTS.job + DEFAULT_WEIGHTS.subject;
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });

  it("all evidence components have weight and contribution", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.7,
      subjectBusinessProbability: 0.6,
      signatureCompanyMatchConfidence: 0.5,
      jobReferenceConfidence: 0.4,
      senderStatus: "OBSERVED"
    });
    for (const key of ["content", "sender", "signature", "job", "subject"] as const) {
      expect(result[key].weight).toBeGreaterThan(0);
      expect(typeof result[key].contribution).toBe("number");
      expect(typeof result[key].explanation).toBe("string");
    }
  });

  it("LIKELY_BUSINESS sender gets high probability", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.5,
      subjectBusinessProbability: 0.5,
      signatureCompanyMatchConfidence: 0,
      jobReferenceConfidence: 0,
      senderStatus: "LIKELY_BUSINESS"
    });
    expect(result.sender.probability).toBe(0.85);
  });

  it("BLOCKED sender gets very low probability", () => {
    const result = calculateBusinessProbability({
      contentBusinessProbability: 0.5,
      subjectBusinessProbability: 0.5,
      signatureCompanyMatchConfidence: 0,
      jobReferenceConfidence: 0,
      senderStatus: "BLOCKED"
    });
    expect(result.sender.probability).toBe(0.02);
  });
});
