import { describe, expect, it } from "vitest";

import {
  parseSemanticSignals,
  SemanticSignalValidationError,
} from "../semantic-signals/types.js";
import {
  buildSemanticSignalUserPrompt,
  semanticSignalJsonSchema,
  semanticSignalSystemPrompt,
} from "../semantic-signals/prompt.js";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    contentBusinessProbability: 0.82,
    subjectBusinessProbability: 0.91,
    signatureCompanyMatchConfidence: 0,
    jobReferenceConfidence: 0.4,
    summary: "Request for revised shop drawings on Project 42.",
    containsActionRequest: true,
    hasExplicitDeadline: false,
    deadlineUrgency: "NONE",
    signalExplanations: {
      content: "Body asks for shop drawing revisions.",
      subject: "Subject references Project 42 drawings.",
      signature: "No verified workspace entity match.",
      job: "Mentions Project 42 without exact candidate match.",
      deadline: "No explicit deadline stated.",
    },
    ...overrides,
  };
}

describe("production n8n semantic signal contract", () => {
  it("accepts a complete valid payload", () => {
    const signals = parseSemanticSignals(validPayload());
    expect(signals).toEqual(validPayload());
  });

  it("accepts STANDARD / URGENT only when hasExplicitDeadline is true", () => {
    expect(
      parseSemanticSignals(
        validPayload({
          hasExplicitDeadline: true,
          deadlineUrgency: "STANDARD",
          signalExplanations: {
            ...(validPayload().signalExplanations as object),
            deadline: "Due Friday.",
          },
        })
      ).deadlineUrgency
    ).toBe("STANDARD");

    expect(
      parseSemanticSignals(
        validPayload({
          hasExplicitDeadline: true,
          deadlineUrgency: "URGENT",
          signalExplanations: {
            ...(validPayload().signalExplanations as object),
            deadline: "Need this today.",
          },
        })
      ).deadlineUrgency
    ).toBe("URGENT");
  });

  it("rejects probability outside 0–1 (no silent clamp)", () => {
    expect(() =>
      parseSemanticSignals(validPayload({ contentBusinessProbability: 1.5 }))
    ).toThrow(SemanticSignalValidationError);
    expect(() =>
      parseSemanticSignals(validPayload({ subjectBusinessProbability: -0.01 }))
    ).toThrow(/between 0 and 1/);
  });

  it("rejects non-numeric probabilities", () => {
    expect(() =>
      parseSemanticSignals(
        validPayload({ jobReferenceConfidence: "0.5" as unknown as number })
      )
    ).toThrow(/jobReferenceConfidence must be a finite number/);
  });

  it("rejects summary longer than 300 characters", () => {
    expect(() =>
      parseSemanticSignals(validPayload({ summary: "x".repeat(301) }))
    ).toThrow(/summary must be ≤300/);
  });

  it("rejects missing required fields", () => {
    const { summary: _summary, ...rest } = validPayload();
    void _summary;
    expect(() => parseSemanticSignals(rest)).toThrow(/missing required field "summary"/);
  });

  it("rejects invalid deadlineUrgency", () => {
    expect(() =>
      parseSemanticSignals(validPayload({ deadlineUrgency: "HIGH" }))
    ).toThrow(/NONE \| STANDARD \| URGENT/);
  });

  it("rejects hasExplicitDeadline=false with non-NONE urgency", () => {
    expect(() =>
      parseSemanticSignals(
        validPayload({
          hasExplicitDeadline: false,
          deadlineUrgency: "URGENT",
        })
      )
    ).toThrow(/deadlineUrgency must be "NONE"/);
  });

  it("rejects incomplete signalExplanations", () => {
    expect(() =>
      parseSemanticSignals(
        validPayload({
          signalExplanations: {
            content: "c",
            subject: "s",
            signature: "sig",
            job: "j",
            // deadline missing
          },
        })
      )
    ).toThrow(/signalExplanations.deadline/);
  });

  it("rejects unexpected top-level properties", () => {
    expect(() =>
      parseSemanticSignals(validPayload({ mailboxCategory: "BUSINESS" }))
    ).toThrow(/unexpected top-level property "mailboxCategory"/);
  });

  it("rejects unexpected explanation properties", () => {
    expect(() =>
      parseSemanticSignals(
        validPayload({
          signalExplanations: {
            ...(validPayload().signalExplanations as object),
            priority: "should not be here",
          },
        })
      )
    ).toThrow(/unexpected signalExplanations property "priority"/);
  });

  it("system prompt matches production n8n semantic extractor role", () => {
    expect(semanticSignalSystemPrompt).toContain(
      "PRIMARY semantic signal extractor for an operating structural-steel fabrication business"
    );
    expect(semanticSignalSystemPrompt).toContain(
      "You do NOT decide BUSINESS vs PERSONAL."
    );
    expect(semanticSignalSystemPrompt).toContain(
      "You do NOT determine the final email priority."
    );
    expect(semanticSignalSystemPrompt).toContain("candidateLookupFailed=true");
    expect(semanticSignalSystemPrompt).toContain("deadlineUrgency MUST equal NONE");
    expect(semanticSignalSystemPrompt).not.toMatch(/reconstructed|placeholder/i);
  });

  it("JSON schema matches production required fields", () => {
    expect(semanticSignalJsonSchema.required).toEqual([
      "contentBusinessProbability",
      "subjectBusinessProbability",
      "signatureCompanyMatchConfidence",
      "jobReferenceConfidence",
      "summary",
      "containsActionRequest",
      "hasExplicitDeadline",
      "deadlineUrgency",
      "signalExplanations",
    ]);
    expect(semanticSignalJsonSchema.properties.deadlineUrgency.enum).toEqual([
      "NONE",
      "STANDARD",
      "URGENT",
    ]);
    expect(semanticSignalJsonSchema.additionalProperties).toBe(false);
  });

  it("user prompt matches production n8n template sections", () => {
    const prompt = buildSemanticSignalUserPrompt({
      normalizedSubject: "PO #1 — Project Alpha",
      senderName: "Jane Doe",
      senderEmail: "jane@vendor.com",
      senderDomain: "vendor.com",
      cleanBody: "Please send pricing by Friday.",
      attachmentNames: ["quote.pdf"],
      senderEvidence: { status: "LIKELY_BUSINESS", confidence: 0.7 },
      domainEvidence: { status: "OBSERVED", isPublicDomain: false },
      knownSender: true,
      customerCandidates: [{ id: "c1", name: "Acme", score: 0.9 }],
      vendorCandidates: [],
      jobCandidates: [{ id: "j1", name: "Alpha", score: 0.85 }],
      approvedJobAliases: [
        { jobId: "j1", alias: "Project Alpha", normalizedAlias: "project alpha" },
      ],
      classificationInstructions: [{ title: "Rule", content: "Prefer job numbers" }],
      candidateLookupFailed: false,
    });

    expect(prompt).toContain("Subject: PO #1 — Project Alpha");
    expect(prompt).toContain("Sender Name: Jane Doe");
    expect(prompt).toContain("Sender Email: jane@vendor.com");
    expect(prompt).toContain("Sender Domain: vendor.com");
    expect(prompt).toContain("Clean Body:");
    expect(prompt).toContain("Please send pricing by Friday.");
    expect(prompt).toContain("Attachments:");
    expect(prompt).toContain("quote.pdf");
    expect(prompt).toContain("--- SUPPORTING WORKSPACE EVIDENCE ---");
    expect(prompt).toContain("Sender Evidence:");
    expect(prompt).toContain("Domain Evidence:");
    expect(prompt).toContain("Known Sender:");
    expect(prompt).toContain("Customer Candidates:");
    expect(prompt).toContain("Vendor Candidates:");
    expect(prompt).toContain("Job Candidates:");
    expect(prompt).toContain("Approved Job Aliases:");
    expect(prompt).toContain("Classification Instructions:");
    expect(prompt).toContain("Candidate Lookup Failed:");
    expect(prompt).toContain("Do NOT decide BUSINESS vs PERSONAL.");
    expect(prompt).toContain("Do NOT assign LOW / NORMAL / HIGH / URGENT priority.");
    expect(prompt).toContain('"status":"LIKELY_BUSINESS"');
    expect(prompt).toContain("project alpha");
  });

  it("user prompt uses None when attachments empty", () => {
    const prompt = buildSemanticSignalUserPrompt({
      normalizedSubject: "Hi",
      senderEmail: "a@b.com",
      cleanBody: "",
      attachmentNames: [],
      knownSender: false,
      customerCandidates: [],
      vendorCandidates: [],
      jobCandidates: [],
      approvedJobAliases: [],
      classificationInstructions: [],
      candidateLookupFailed: true,
    });
    expect(prompt).toContain("Attachments:\nNone");
    expect(prompt).toContain("Candidate Lookup Failed:\ntrue");
  });
});
