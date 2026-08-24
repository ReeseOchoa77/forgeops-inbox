import { describe, expect, it } from "vitest";

import { extractHistoricalN8nComparableSignals } from "../reference/historical-n8n-signals.js";

describe("extractHistoricalN8nComparableSignals", () => {
  it("extracts flags+cumulative evidence probabilities and decisionRule", () => {
    const result = extractHistoricalN8nComparableSignals({
      classification: {
        mailboxCategory: "BUSINESS",
        summary: "PO review for Project 42",
        containsActionRequest: true,
        modelName: "n8n-openai",
        classificationEvidence: {
          content: {
            probability: 0.82,
            strongFlag: true,
            explanation: "Body requests pricing",
          },
          subject: {
            probability: 0.9,
            strongFlag: true,
            explanation: "Subject has PO",
          },
          signature: {
            probability: 0,
            includedInDecision: false,
            explanation: "No verified match",
          },
          job: {
            probability: 0.55,
            strongFlag: false,
            explanation: "Mentions Project 42",
          },
          decisionRule: "STRONG_BUSINESS_FLAG",
          classificationDecision: { rule: "STRONG_BUSINESS_FLAG" },
          priorityDecision: {
            hasExplicitDeadline: true,
            deadlineUrgency: "STANDARD",
            containsActionRequest: true,
          },
        },
      },
    });

    expect(result.hasMeaningfulComparisonBasis).toBe(true);
    expect(result.contentBusinessProbability).toBe(0.82);
    expect(result.subjectBusinessProbability).toBe(0.9);
    expect(result.signatureCompanyMatchConfidence).toBe(0);
    expect(result.jobReferenceConfidence).toBe(0.55);
    expect(result.containsActionRequest).toBe(true);
    expect(result.hasExplicitDeadline).toBe(true);
    expect(result.deadlineUrgency).toBe("STANDARD");
    expect(result.mailboxCategory).toBe("BUSINESS");
    expect(result.decisionRule).toBe("STRONG_BUSINESS_FLAG");
    expect(result.summary).toBe("PO review for Project 42");
    expect(result.signalExplanations.content).toBe("Body requests pricing");
    expect(result.signalExplanations.deadline).toBeNull();
    expect(result.unavailableFields).toContain("signalExplanations.deadline");
    expect(result.unavailableFields).not.toContain("contentBusinessProbability");
  });

  it("falls back to rawAiPayload probability fields when evidence lacks them", () => {
    const result = extractHistoricalN8nComparableSignals({
      classification: {
        mailboxCategory: "PERSONAL",
        summary: "Dinner plans",
        containsActionRequest: false,
        classificationEvidence: { decisionRule: "CUMULATIVE_PERSONAL" },
        rawAiPayload: {
          contentBusinessProbability: 0.12,
          subjectBusinessProbability: 0.2,
          signatureCompanyMatchConfidence: 0,
          jobReferenceConfidence: 0.05,
          summary: "Dinner plans",
        },
      },
    });

    expect(result.contentBusinessProbability).toBe(0.12);
    expect(result.fieldSources.contentBusinessProbability).toBe(
      "rawAiPayload.contentBusinessProbability"
    );
    expect(result.hasMeaningfulComparisonBasis).toBe(true);
  });

  it("marks deadline fields unavailable when priorityDecision missing", () => {
    const result = extractHistoricalN8nComparableSignals({
      classification: {
        mailboxCategory: "BUSINESS",
        summary: "Update",
        containsActionRequest: false,
        classificationEvidence: {
          content: { probability: 0.7, explanation: "c" },
          subject: { probability: 0.6, explanation: "s" },
          job: { probability: 0.4, explanation: "j" },
          signature: { probability: 0, explanation: "sig" },
          decisionRule: "CUMULATIVE_PERSONAL",
        },
      },
    });

    expect(result.hasExplicitDeadline).toBeNull();
    expect(result.deadlineUrgency).toBeNull();
    expect(result.unavailableFields).toEqual(
      expect.arrayContaining(["hasExplicitDeadline", "deadlineUrgency"])
    );
  });

  it("reports no meaningful basis when only legacy weighted evidence exists without category", () => {
    const result = extractHistoricalN8nComparableSignals({
      classification: {
        mailboxCategory: null,
        classificationEvidence: {
          content: { probability: 0.9, weight: 0.4, contribution: 0.36 },
          finalBusinessProbability: 0.7,
        },
      },
      messageMailboxCategory: null,
    });

    expect(result.hasMeaningfulComparisonBasis).toBe(false);
    expect(result.unavailableFields).toContain("mailboxCategory");
  });

  it("uses EmailMessage.mailboxCategory fallback", () => {
    const result = extractHistoricalN8nComparableSignals({
      classification: {
        mailboxCategory: null,
        summary: "x",
        containsActionRequest: false,
        classificationEvidence: {
          content: { probability: 0.85, explanation: "c" },
          decisionRule: "STRONG_BUSINESS_FLAG",
        },
      },
      messageMailboxCategory: "BUSINESS",
    });

    expect(result.mailboxCategory).toBe("BUSINESS");
    expect(result.fieldSources.mailboxCategory).toBe(
      "EmailMessage.mailboxCategory"
    );
    expect(result.hasMeaningfulComparisonBasis).toBe(true);
  });
});
