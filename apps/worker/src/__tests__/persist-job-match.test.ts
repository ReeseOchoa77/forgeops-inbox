import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  buildJobMatchPersistence,
  isManualJobAssignment,
  persistJobMatchResult,
} from "../application/services/persist-job-match.js";
import type { JobMatchResult } from "@forgeops/shared";

const strongMatch: JobMatchResult = {
  selectedJobId: "job-new",
  confidence: 0.96,
  evidence: [
    { type: "SUBJECT_JOB_NUMBER", value: "2198", confidence: 1 },
  ],
  ambiguousCandidateIds: [],
  requiresReview: false,
  assignmentSource: "JOB_NUMBER_MATCH",
  candidateCount: 1,
  matcherVersion: "job-matcher-v1",
};

describe("persist-job-match", () => {
  it("15. manual assignment is protected", () => {
    expect(
      isManualJobAssignment({
        jobAssignmentIsManual: true,
        jobAssignmentSource: "AI_AUTO_ASSIGNED",
      })
    ).toBe(true);
    expect(
      isManualJobAssignment({
        jobAssignmentIsManual: false,
        jobAssignmentSource: "USER_ASSIGNED",
      })
    ).toBe(true);
    expect(
      buildJobMatchPersistence(strongMatch, {
        jobId: "job-manual",
        jobAssignmentIsManual: true,
        jobAssignmentSource: "USER_ASSIGNED",
      })
    ).toBeNull();
  });

  it("13. dual persistence writes Classification + EmailMessage together", async () => {
    const classificationUpdate = vi.fn();
    const emailUpdate = vi.fn();
    const tx = {
      classification: { update: classificationUpdate },
      emailMessage: { update: emailUpdate },
    };

    const result = await persistJobMatchResult(tx, {
      classificationId: "cls-1",
      emailMessageId: "msg-1",
      match: strongMatch,
      existing: {
        jobId: null,
        jobAssignmentIsManual: false,
        jobAssignmentSource: null,
      },
    });

    expect(result.applied).toBe(true);
    expect(result.preservedManual).toBe(false);
    expect(classificationUpdate).toHaveBeenCalledWith({
      where: { id: "cls-1" },
      data: expect.objectContaining({
        jobId: "job-new",
        entityMatchConfidence: expect.any(Prisma.Decimal),
      }),
    });
    expect(emailUpdate).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: expect.objectContaining({
        jobId: "job-new",
        jobAssignmentSource: "JOB_NUMBER_MATCH",
        jobMatchConfidence: expect.any(Number),
      }),
    });

    const clsJobId = classificationUpdate.mock.calls[0]![0].data.jobId;
    const msgJobId = emailUpdate.mock.calls[0]![0].data.jobId;
    expect(clsJobId).toBe(msgJobId);
  });

  it("clears stale auto job when no match", async () => {
    const noMatch: JobMatchResult = {
      ...strongMatch,
      selectedJobId: null,
      confidence: 0.2,
      assignmentSource: null,
      evidence: [],
    };
    const fields = buildJobMatchPersistence(noMatch, {
      jobId: "job-old-auto",
      jobAssignmentIsManual: false,
      jobAssignmentSource: "AI_AUTO_ASSIGNED",
    });
    expect(fields?.emailMessage.jobId).toBeNull();
    expect(fields?.classification.jobId).toBeNull();
  });
});
