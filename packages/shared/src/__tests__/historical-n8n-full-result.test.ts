import { describe, expect, it } from "vitest";

import { extractHistoricalN8nFullResult } from "../reference/historical-n8n-full-result.js";

describe("extractHistoricalN8nFullResult", () => {
  it("extracts complete BUSINESS historical fields from Classification + Task rows", () => {
    const result = extractHistoricalN8nFullResult({
      messageMailboxCategory: "BUSINESS",
      classification: {
        mailboxCategory: "BUSINESS",
        summary: "Vendor quote for Project 42",
        containsActionRequest: true,
        businessTypeKey: "VENDOR_QUOTE",
        businessTypeConfidence: 0.91,
        customerId: "cust-1",
        vendorId: "vend-1",
        jobId: "job-matcher-ignore",
        entityMatchConfidence: 0.84,
        matchEvidence: ["sender domain", "job alias"],
        priority: "MEDIUM",
        classificationEvidence: {
          content: { probability: 0.9, explanation: "quote language" },
          subject: { probability: 0.7, explanation: "Project 42" },
          signature: { probability: 0.5, explanation: "Acme" },
          job: { probability: 0.85, explanation: "Project 42" },
          decisionRule: "CONTENT_HIGH",
          priorityDecision: {
            rule: "JOB_WITH_ACTION_NO_DEADLINE",
            jobRelated: true,
            containsActionRequest: true,
            hasExplicitDeadline: false,
            deadlineUrgency: "NONE",
          },
        },
        rawAiPayload: {
          selectedJobId: "job-n8n-hint",
          contentBusinessProbability: 0.9,
        },
      },
      tasks: [
        {
          title: "Review quote",
          description: "Compare line items",
          dueAt: null,
          assigneeGuess: "Alex",
          confidence: 0.8,
        },
      ],
    });

    expect(result.businessType).toBe("VENDOR_QUOTE");
    expect(result.businessTypeConfidence).toBe(0.91);
    expect(result.selectedCustomerId).toBe("cust-1");
    expect(result.selectedVendorId).toBe("vend-1");
    expect(result.selectedJobId).toBe("job-n8n-hint");
    expect(result.fieldSources.selectedJobId).toBe("rawAiPayload.selectedJobId");
    expect(result.entityMatchConfidence).toBe(0.84);
    expect(result.matchEvidence).toEqual(["sender domain", "job alias"]);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks?.[0]?.recommendedOwner).toBe("Alex");
    expect(result.priority).toBe("NORMAL");
    expect(result.priorityDecision?.rule).toBe("JOB_WITH_ACTION_NO_DEADLINE");
    expect(result.unavailableFields).not.toContain("selectedJobId");
    expect(result.unavailableFields).not.toContain("tasks");
  });

  it("never uses Classification.jobId for selectedJobId", () => {
    const result = extractHistoricalN8nFullResult({
      classification: {
        mailboxCategory: "BUSINESS",
        jobId: "forgeops-job-matcher-id",
        customerId: null,
        vendorId: null,
        classificationEvidence: {
          content: { probability: 0.9 },
          decisionRule: "CONTENT_HIGH",
        },
        rawAiPayload: {},
      },
    });

    expect(result.selectedJobId).toBeNull();
    expect(result.fieldSources.selectedJobId).toBeNull();
    expect(result.unavailableFields).toContain("selectedJobId");
  });

  it("marks unavailable fields without fabricating values", () => {
    const result = extractHistoricalN8nFullResult({
      classification: {
        mailboxCategory: "PERSONAL",
        classificationEvidence: {
          content: { probability: 0.1 },
          decisionRule: "CONTENT_LOW",
        },
        rawAiPayload: { summary: "Family dinner" },
      },
    });

    expect(result.businessType).toBeNull();
    expect(result.businessTypeConfidence).toBeNull();
    expect(result.selectedJobId).toBeNull();
    expect(result.tasks).toBeNull();
    expect(result.priority).toBeNull();
    expect(result.priorityDecision).toBeNull();
    expect(result.unavailableFields).toEqual(
      expect.arrayContaining([
        "businessType",
        "businessTypeConfidence",
        "selectedJobId",
        "entityMatchConfidence",
        "matchEvidence",
        "tasks",
        "priority",
        "priorityDecision",
      ])
    );
  });

  it("falls back to rawAiPayload.tasks when Task rows are absent", () => {
    const result = extractHistoricalN8nFullResult({
      classification: {
        mailboxCategory: "BUSINESS",
        customerId: "c1",
        vendorId: null,
        classificationEvidence: {
          content: { probability: 0.8 },
          decisionRule: "CONTENT_HIGH",
        },
        rawAiPayload: {
          selectedJobId: null,
          tasks: [
            {
              title: "Call client",
              description: "Follow up on bid",
              dueDate: "2026-08-01T00:00:00.000Z",
              recommendedOwner: "Sam",
              confidence: 0.7,
            },
          ],
        },
      },
    });

    expect(result.fieldSources.tasks).toBe("rawAiPayload.tasks");
    expect(result.tasks?.[0]?.title).toBe("Call client");
    expect(result.selectedJobId).toBeNull();
    expect(result.fieldSources.selectedJobId).toBe("rawAiPayload.selectedJobId");
  });
});
