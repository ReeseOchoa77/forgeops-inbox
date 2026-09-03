import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../application/services/prisma-job-match-loader.js", () => ({
  createJobMatcherService: () => ({
    match: vi.fn().mockResolvedValue({
      selectedJobId: null,
      confidence: 0,
      evidence: [],
      ambiguousCandidateIds: [],
      requiresReview: false,
      assignmentSource: null,
      candidateCount: 0,
      matcherVersion: "test",
    }),
  }),
}));

import { persistNativeClassificationResult } from "../application/services/persist-native-classification.js";

function baseMessage() {
  return {
    id: "m1",
    threadId: "t1",
    subject: "Sub",
    senderName: "A",
    senderEmail: "a@b.com",
    toAddresses: [],
    ccAddresses: [],
    bccAddresses: [],
    replyToAddresses: [],
    snippet: null,
    bodyText: "Please submit the RFI response.",
    labelIds: [],
    sentAt: new Date("2026-01-01T00:00:00Z"),
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    jobId: null,
    jobAssignmentIsManual: false,
    jobAssignmentSource: null,
    attachmentMetadata: null,
    thread: { subject: "Sub" },
  };
}

function businessPipeline(
  tasks: Array<{
    title: string;
    description: string;
    confidence: number;
    recommendedOwner: string | null;
    dueDate: string | null;
  }>
) {
  return {
    candidates: null,
    candidateLookupFailed: false,
    semanticSignals: {
      contentBusinessProbability: 0.9,
      subjectBusinessProbability: 0.8,
      signatureCompanyMatchConfidence: 0,
      jobReferenceConfidence: 0.2,
      summary: "Action needed",
      containsActionRequest: tasks.length > 0,
      hasExplicitDeadline: false,
      deadlineUrgency: "NONE" as const,
      signalExplanations: {
        content: "c",
        subject: "s",
        signature: "sig",
        job: "j",
        deadline: "d",
      },
    },
    mailboxDecision: {
      mailboxCategory: "BUSINESS" as const,
      confidence: 0.9,
      requiresReview: false,
      decisionRule: "flags",
      classificationDecision: "BUSINESS",
      classificationEvidence: {},
      reasons: [],
    },
    businessSubtype: {
      businessType: "RFI_CLARIFICATION",
      businessTypeConfidence: 0.9,
      reasons: [],
    },
    entities: {
      selectedCustomerId: null,
      selectedVendorId: null,
      selectedJobId: null,
      entityMatchConfidence: 0,
      matchEvidence: [],
    },
    tasks,
    priorityDecision: {
      priority: "NORMAL" as const,
      reasons: [],
      jobReferenceConfidence: 0.2,
      containsActionRequest: tasks.length > 0,
      hasExplicitDeadline: false,
      deadlineUrgency: "NONE" as const,
    },
    skippedStages: [] as string[],
    confirmedJobForcedBusiness: false,
  };
}

describe("persistNativeClassificationResult taskMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REMOVE_ONLY deletes classifier tasks and writes none after core success", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const taskUpsert = vi.fn();
    const prisma = {
      emailMessage: {
        findFirst: vi.fn().mockResolvedValue(baseMessage()),
      },
      job: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockResolvedValue({
        classificationId: "cls1",
        mailboxCategory: "BUSINESS",
        priority: "MEDIUM",
      }),
      task: {
        deleteMany,
        upsert: taskUpsert,
        findMany: vi.fn(),
      },
    };

    const result = await persistNativeClassificationResult({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "c1",
      emailMessageId: "m1",
      pipeline: businessPipeline([
        {
          title: "Do thing",
          description: "d",
          confidence: 0.9,
          recommendedOwner: null,
          dueDate: null,
        },
      ]) as never,
      taskMode: "REMOVE_ONLY",
    });

    expect(result.tasksWritten).toBe(0);
    expect(result.tasksRemoved).toBe(2);
    expect(taskUpsert).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workspaceId: "ws",
        sourceMessageId: "m1",
      }),
    });
  });

  it("REGENERATE replaces classifier tasks and leaves manual keys alone", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    // DB query already scoped to classifier keys — manual tasks never returned.
    const findMany = vi.fn().mockResolvedValue([
      { id: "ai-old", sourceTaskKey: "native:0:old:abcd1234" },
    ]);

    const prisma = {
      emailMessage: {
        findFirst: vi.fn().mockResolvedValue(baseMessage()),
      },
      job: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockResolvedValue({
        classificationId: "cls1",
        mailboxCategory: "BUSINESS",
        priority: "MEDIUM",
      }),
      task: {
        deleteMany,
        upsert,
        findMany,
      },
    };

    const result = await persistNativeClassificationResult({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "c1",
      emailMessageId: "m1",
      pipeline: businessPipeline([
        {
          title: "New task",
          description: "d",
          confidence: 0.95,
          recommendedOwner: null,
          dueDate: null,
        },
      ]) as never,
      taskMode: "REGENERATE",
    });

    expect(result.tasksWritten).toBe(1);
    expect(upsert).toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workspaceId: "ws",
        sourceMessageId: "m1",
        OR: [
          { sourceTaskKey: { startsWith: "native:" } },
          { sourceTaskKey: "heuristic-primary" },
        ],
      }),
      select: { id: true, sourceTaskKey: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ai-old"] } },
    });
  });

  it("production path without taskMode leaves BUSINESS empty-task set untouched", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      emailMessage: {
        findFirst: vi.fn().mockResolvedValue(baseMessage()),
      },
      job: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockResolvedValue({
        classificationId: "cls1",
        mailboxCategory: "BUSINESS",
        priority: "MEDIUM",
      }),
      task: {
        deleteMany,
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
    };

    await persistNativeClassificationResult({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "c1",
      emailMessageId: "m1",
      pipeline: businessPipeline([]) as never,
    });

    expect(deleteMany).not.toHaveBeenCalled();
  });
});
