import { describe, expect, it } from "vitest";
import { JOB_MATCHER_VERSION } from "@forgeops/shared";

import {
  assembleClassificationCandidates,
  type ClassificationCandidatesSourceData,
} from "../application/services/classification-candidates-service.js";

function emptyData(
  overrides: Partial<ClassificationCandidatesSourceData> = {}
): ClassificationCandidatesSourceData {
  return {
    contacts: [],
    aliases: [],
    customers: [],
    vendors: [],
    jobs: [],
    businessTypes: [
      {
        systemKey: "OTHER_BUSINESS",
        displayLabel: "Other Business",
        displayGroup: "OTHER",
        displayOrder: 1,
      },
    ],
    instructions: [{ title: "Rule", content: "Prefer job numbers" }],
    senderEvidence: null,
    domainEvidence: null,
    approvedFolders: [],
    ...overrides,
  };
}

describe("assembleClassificationCandidates (n8n response parity)", () => {
  it("returns the n8n response shape with matcherVersion and empty candidates", () => {
    const result = assembleClassificationCandidates(
      "ws_1",
      {
        senderEmail: "a@example.com",
        senderDomain: "example.com",
        subject: "Hello",
        cleanBody: "Hi",
        attachmentNames: [],
      },
      emptyData()
    );

    expect(result).toMatchObject({
      workspaceId: "ws_1",
      knownSender: false,
      matcherVersion: JOB_MATCHER_VERSION,
      customerCandidates: [],
      vendorCandidates: [],
      jobCandidates: [],
      senderEvidence: null,
      domainEvidence: null,
    });
    expect(result.activeBusinessTypes).toEqual([
      {
        key: "OTHER_BUSINESS",
        label: "Other Business",
        group: "OTHER",
        order: 1,
      },
    ]);
    expect(result.classificationInstructions).toEqual([
      { title: "Rule", content: "Prefer job numbers" },
    ]);
  });

  it("matches customer by primary email and contact domain", () => {
    const result = assembleClassificationCandidates(
      "ws_1",
      {
        senderEmail: "john@acme.com",
        senderDomain: "acme.com",
        subject: "PO",
        cleanBody: "Please review",
      },
      emptyData({
        customers: [
          {
            id: "c1",
            name: "Acme",
            normalizedName: "acme",
            domain: "acme.com",
            primaryEmail: "john@acme.com",
          },
        ],
        contacts: [
          {
            id: "ct1",
            customerId: "c1",
            vendorId: null,
            normalizedEmail: "john@acme.com",
            domain: "acme.com",
          },
        ],
      })
    );

    expect(result.knownSender).toBe(true);
    expect(result.customerCandidates).toHaveLength(1);
    expect(result.customerCandidates[0]).toMatchObject({
      id: "c1",
      name: "Acme",
      score: 1,
    });
    expect(result.customerCandidates[0]!.matchedOn).toEqual(
      expect.arrayContaining(["email", "domain"])
    );
    expect(result.customerCandidates[0]!.evidence.length).toBeGreaterThan(0);
  });

  it("includes senderEvidence and domainEvidence in n8n field names", () => {
    const result = assembleClassificationCandidates(
      "ws_1",
      {
        senderEmail: "x@vendor.com",
        senderDomain: "vendor.com",
      },
      emptyData({
        senderEvidence: {
          status: "LIKELY_BUSINESS",
          confidence: 0.77,
          businessEvidenceCount: 3,
          personalEvidenceCount: 1,
        },
        domainEvidence: {
          status: "OBSERVED",
          confidence: { toString: () => "0.4" },
          isPublicDomain: false,
        },
      })
    );

    expect(result.knownSender).toBe(true);
    expect(result.senderEvidence).toEqual({
      status: "LIKELY_BUSINESS",
      confidence: 0.77,
      businessCount: 3,
      personalCount: 1,
    });
    expect(result.domainEvidence).toEqual({
      status: "OBSERVED",
      confidence: 0.4,
      isPublicDomain: false,
    });
  });

  it("scores jobs via job number in subject and caps at 5", () => {
    const jobs = Array.from({ length: 8 }, (_, i) => ({
      id: `j${i}`,
      name: `Job ${i}`,
      normalizedName: `job ${i}`,
      jobNumber: `J-${1000 + i}`,
      customerId: null,
      externalRef: null,
    }));

    const result = assembleClassificationCandidates(
      "ws_1",
      {
        senderEmail: "a@b.com",
        senderDomain: "b.com",
        subject: "Update on J-1000 and J-1001 and J-1002 and J-1003 and J-1004 and J-1005",
        cleanBody: "See attached",
        attachmentNames: ["file.pdf"],
      },
      emptyData({ jobs })
    );

    expect(result.jobCandidates.length).toBeLessThanOrEqual(5);
    expect(result.jobCandidates[0]?.score).toBeGreaterThan(0);
    expect(result.matcherVersion).toBe(JOB_MATCHER_VERSION);
  });

  it("matches approved folder job number into jobCandidates", () => {
    const result = assembleClassificationCandidates(
      "ws_1",
      {
        senderEmail: "a@b.com",
        senderDomain: "b.com",
        subject: "Re: Project 42",
        cleanBody: "Job 42 materials",
      },
      emptyData({
        jobs: [
          {
            id: "job42",
            name: "Project Forty Two",
            normalizedName: "project forty two",
            jobNumber: "42",
            customerId: null,
            externalRef: null,
          },
        ],
        approvedFolders: [
          {
            normalizedFolderName: "project 42",
            matchedJobId: "job42",
            rawFolderName: "Project 42",
            detectedJobNumber: "42",
          },
        ],
      })
    );

    expect(result.jobCandidates.some((j) => j.id === "job42")).toBe(true);
    const hit = result.jobCandidates.find((j) => j.id === "job42")!;
    expect(hit.matchedOn).toContain("folderJobNumber");
    expect(hit.score).toBeGreaterThanOrEqual(0.95);
  });
});
