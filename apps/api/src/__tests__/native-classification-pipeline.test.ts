import { describe, expect, it, vi } from "vitest";

import type {
  OpenAIBusinessSubtypeClassifier,
  OpenAIEntitySelector,
  OpenAISemanticSignalExtractor,
  OpenAITaskExtractor,
  SemanticSignals,
} from "@forgeops/ai";

import type { ClassificationCandidatesService } from "../application/services/classification-candidates-service.js";
import { runNativeClassificationPipeline } from "../application/services/native-classification-pipeline.js";

function businessSignals(
  overrides: Partial<SemanticSignals> = {}
): SemanticSignals {
  return {
    contentBusinessProbability: 0.9,
    subjectBusinessProbability: 0.85,
    signatureCompanyMatchConfidence: 0,
    jobReferenceConfidence: 0.9,
    summary: "Please send revised drawings by Friday.",
    containsActionRequest: true,
    hasExplicitDeadline: true,
    deadlineUrgency: "STANDARD",
    signalExplanations: {
      content: "c",
      subject: "s",
      signature: "sig",
      job: "j",
      deadline: "d",
    },
    ...overrides,
  };
}

function personalSignals(): SemanticSignals {
  return businessSignals({
    contentBusinessProbability: 0.1,
    subjectBusinessProbability: 0.1,
    jobReferenceConfidence: 0.05,
    summary: "Dinner tonight?",
    containsActionRequest: false,
    hasExplicitDeadline: false,
    deadlineUrgency: "NONE",
  });
}

describe("runNativeClassificationPipeline", () => {
  it("PERSONAL skips business-only AI stages", async () => {
    const subtype = { classify: vi.fn() };
    const entities = { select: vi.fn() };
    const tasks = { extract: vi.fn() };

    const result = await runNativeClassificationPipeline(
      {
        workspaceId: "ws",
        mailboxEmail: "inbox@co.com",
        senderEmail: "friend@gmail.com",
        normalizedSubject: "Dinner",
        cleanBody: "Want to grab dinner?",
        candidateLookupFailed: true,
      },
      {
        candidatesService: {
          getCandidates: vi.fn(),
          listApprovedJobAliases: vi.fn(),
        } as unknown as ClassificationCandidatesService,
        semanticSignalExtractor: {
          extract: vi.fn().mockResolvedValue(personalSignals()),
        } as unknown as OpenAISemanticSignalExtractor,
        businessSubtypeClassifier:
          subtype as unknown as OpenAIBusinessSubtypeClassifier,
        entitySelector: entities as unknown as OpenAIEntitySelector,
        taskExtractor: tasks as unknown as OpenAITaskExtractor,
      }
    );

    expect(result.mailboxDecision.mailboxCategory).toBe("PERSONAL");
    expect(result.businessSubtype).toBeNull();
    expect(result.entities).toBeNull();
    expect(result.tasks).toEqual([]);
    expect(result.skippedStages).toEqual(
      expect.arrayContaining([
        "businessSubtype",
        "entitySelection",
        "taskExtraction",
      ])
    );
    expect(subtype.classify).not.toHaveBeenCalled();
    expect(entities.select).not.toHaveBeenCalled();
    expect(tasks.extract).not.toHaveBeenCalled();
    expect(result.priorityDecision.priority).toBe("LOW");
  });

  it("BUSINESS runs subtype → entities → tasks → deterministic priority", async () => {
    const subtype = {
      classify: vi.fn().mockResolvedValue({
        businessType: "SUBMITTAL_SHOP_DRAWING",
        businessTypeConfidence: 0.93,
      }),
    };
    const entities = {
      select: vi.fn().mockResolvedValue({
        selectedCustomerId: "c1",
        selectedVendorId: null,
        selectedJobId: "j1",
        entityMatchConfidence: 0.8,
        matchEvidence: ["job number in subject"],
      }),
    };
    const tasks = {
      extract: vi.fn().mockResolvedValue({
        tasks: [
          {
            title: "Send revised drawings",
            description: "Reply with revised shop drawings",
            dueDate: null,
            recommendedOwner: null,
            confidence: 0.9,
          },
        ],
      }),
    };

    const result = await runNativeClassificationPipeline(
      {
        workspaceId: "ws",
        mailboxEmail: "inbox@co.com",
        senderEmail: "gc@builder.com",
        senderDomain: "builder.com",
        normalizedSubject: "Shop drawings — Project 42",
        cleanBody: "Please send the revised drawings by Friday.",
        candidateLookupFailed: false,
      },
      {
        candidatesService: {
          getCandidates: vi.fn().mockResolvedValue({
            knownSender: true,
            customerCandidates: [{ id: "c1", name: "Builder", score: 0.9, matchedOn: [], evidence: [] }],
            vendorCandidates: [],
            jobCandidates: [{ id: "j1", name: "Project 42", score: 0.95, matchedOn: [], evidence: [] }],
            senderEvidence: { status: "LIKELY_BUSINESS", confidence: 0.7, businessCount: 2, personalCount: 0 },
            domainEvidence: null,
            activeBusinessTypes: [
              { key: "SUBMITTAL_SHOP_DRAWING", label: "Submittal", group: "PROJECTS", order: 1 },
            ],
            classificationInstructions: [],
            workspaceId: "ws",
            matcherVersion: "job-matcher-v1",
          }),
          listApprovedJobAliases: vi.fn().mockResolvedValue([]),
        } as unknown as ClassificationCandidatesService,
        semanticSignalExtractor: {
          extract: vi.fn().mockResolvedValue(businessSignals()),
        } as unknown as OpenAISemanticSignalExtractor,
        businessSubtypeClassifier:
          subtype as unknown as OpenAIBusinessSubtypeClassifier,
        entitySelector: entities as unknown as OpenAIEntitySelector,
        taskExtractor: tasks as unknown as OpenAITaskExtractor,
      }
    );

    expect(result.mailboxDecision.mailboxCategory).toBe("BUSINESS");
    expect(subtype.classify).toHaveBeenCalledTimes(1);
    expect(entities.select).toHaveBeenCalledTimes(1);
    expect(tasks.extract).toHaveBeenCalledTimes(1);
    expect(result.businessSubtype).toEqual({
      businessType: "SUBMITTAL_SHOP_DRAWING",
      businessTypeConfidence: 0.93,
    });
    expect(result.entities?.selectedJobId).toBe("j1");
    expect(result.tasks).toHaveLength(1);
    expect(result.priorityDecision).toMatchObject({
      priority: "HIGH",
      rule: "JOB_WITH_ACTION_DEADLINE",
      containsActionRequest: true,
      hasExplicitDeadline: true,
      deadlineUrgency: "STANDARD",
    });
  });

  it("skips task model call when semantic containsActionRequest is false", async () => {
    const tasks = { extract: vi.fn() };
    const result = await runNativeClassificationPipeline(
      {
        workspaceId: "ws",
        mailboxEmail: "inbox@co.com",
        senderEmail: "a@b.com",
        normalizedSubject: "Status update",
        cleanBody: "FYI only",
      },
      {
        candidatesService: {
          getCandidates: vi.fn().mockRejectedValue(new Error("lookup failed")),
          listApprovedJobAliases: vi.fn(),
        } as unknown as ClassificationCandidatesService,
        semanticSignalExtractor: {
          extract: vi.fn().mockResolvedValue(
            businessSignals({
              containsActionRequest: false,
              hasExplicitDeadline: false,
              deadlineUrgency: "NONE",
              jobReferenceConfidence: 0.9,
            })
          ),
        } as unknown as OpenAISemanticSignalExtractor,
        businessSubtypeClassifier: {
          classify: vi.fn().mockResolvedValue({
            businessType: "PROJECT_COORDINATION",
            businessTypeConfidence: 0.7,
          }),
        } as unknown as OpenAIBusinessSubtypeClassifier,
        entitySelector: {
          select: vi.fn().mockResolvedValue({
            selectedCustomerId: null,
            selectedVendorId: null,
            selectedJobId: null,
            entityMatchConfidence: 0,
            matchEvidence: [],
          }),
        } as unknown as OpenAIEntitySelector,
        taskExtractor: tasks as unknown as OpenAITaskExtractor,
      }
    );

    expect(result.candidateLookupFailed).toBe(true);
    expect(tasks.extract).not.toHaveBeenCalled();
    expect(result.tasks).toEqual([]);
    expect(result.skippedStages).toContain("taskExtractionModelCall");
    expect(result.priorityDecision.priority).toBe("LOW");
  });
});
