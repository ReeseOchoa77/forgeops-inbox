import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const previous = process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;

  beforeEach(() => {
    process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "true";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    else process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = previous;
  });

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
    const taskUpdate = vi.fn();
    const tx = {
      classification: { update: classificationUpdate },
      emailMessage: { update: emailUpdate },
      task: { updateMany: taskUpdate },
    };

    const result = await persistJobMatchResult(tx, {
      workspaceId: "ws-1",
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
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", sourceMessageId: { in: ["msg-1"] } },
      data: { jobId: "job-new" },
    });
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

  it("freezes automatic matcher assignment when JOB_MATCHER_AUTO_ASSIGN_ENABLED is off", async () => {
    delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    expect(buildJobMatchPersistence(strongMatch, null)).toBeNull();

    const classificationUpdate = vi.fn();
    const emailUpdate = vi.fn();
    const result = await persistJobMatchResult(
      {
        classification: { update: classificationUpdate },
        emailMessage: { update: emailUpdate },
        task: { updateMany: vi.fn() },
      },
      {
        workspaceId: "ws-1",
        classificationId: "cls-1",
        emailMessageId: "msg-1",
        match: strongMatch,
        existing: { jobId: null, jobAssignmentIsManual: false, jobAssignmentSource: null },
      }
    );
    expect(result.applied).toBe(false);
    expect(classificationUpdate).not.toHaveBeenCalled();
    expect(emailUpdate).not.toHaveBeenCalled();
  });

  it("V1: high-confidence Job number match does not persist jobId when flag off", () => {
    process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "false";
    expect(
      buildJobMatchPersistence(strongMatch, {
        jobId: null,
        jobAssignmentIsManual: false,
        jobAssignmentSource: null,
      })
    ).toBeNull();
  });

  it("V1: AI_SUGGESTED / AI_AUTO_ASSIGNED matches do not persist when flag off", () => {
    delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    const suggested: JobMatchResult = {
      ...strongMatch,
      assignmentSource: "AI_SUGGESTED",
      confidence: 0.99,
    };
    const auto: JobMatchResult = {
      ...strongMatch,
      assignmentSource: "AI_AUTO_ASSIGNED",
      confidence: 0.99,
    };
    expect(buildJobMatchPersistence(suggested, null)).toBeNull();
    expect(buildJobMatchPersistence(auto, null)).toBeNull();
  });

  it("V1: probabilistic matcher cannot overwrite USER_ASSIGNED or VERIFIED_PROJECT_FOLDER", () => {
    process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "true";
    expect(
      buildJobMatchPersistence(strongMatch, {
        jobId: "job-manual",
        jobAssignmentIsManual: true,
        jobAssignmentSource: "USER_ASSIGNED",
      })
    ).toBeNull();
    expect(
      buildJobMatchPersistence(strongMatch, {
        jobId: "job-folder",
        jobAssignmentIsManual: false,
        jobAssignmentSource: "VERIFIED_PROJECT_FOLDER",
      })
    ).toBeNull();
  });

  it("admin escape hatch: flag true persists JOB_NUMBER_MATCH onto unassigned email", () => {
    process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "true";
    const fields = buildJobMatchPersistence(strongMatch, {
      jobId: null,
      jobAssignmentIsManual: false,
      jobAssignmentSource: null,
    });
    expect(fields?.emailMessage.jobId).toBe("job-new");
    expect(fields?.emailMessage.jobAssignmentSource).toBe("JOB_NUMBER_MATCH");
  });
});
