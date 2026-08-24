import { describe, expect, it } from "vitest";

import {
  decideMailboxPriority,
  N8N_JOB_PRIORITY_THRESHOLD,
} from "../reference/priority-decision.js";

describe("decideMailboxPriority", () => {
  it("boundary: jobReferenceConfidence just below 0.80 → LOW", () => {
    const result = decideMailboxPriority({
      jobReferenceConfidence: 0.799999,
      containsActionRequest: true,
      hasExplicitDeadline: true,
      deadlineUrgency: "URGENT",
    });
    expect(result.priority).toBe("LOW");
    expect(result.rule).toBe("NO_CONFIDENT_JOB_MATCH");
    expect(result.jobRelated).toBe(false);
    expect(result.jobThreshold).toBe(N8N_JOB_PRIORITY_THRESHOLD);
  });

  it("boundary: jobReferenceConfidence exactly 0.80 → job-related", () => {
    const noAction = decideMailboxPriority({
      jobReferenceConfidence: 0.8,
      containsActionRequest: false,
      hasExplicitDeadline: false,
      deadlineUrgency: "NONE",
    });
    expect(noAction).toMatchObject({
      priority: "LOW",
      rule: "JOB_WITHOUT_ACTION_REQUEST",
      jobRelated: true,
    });
  });

  it("NORMAL / HIGH / URGENT distinctions", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.9,
        containsActionRequest: true,
        hasExplicitDeadline: false,
        deadlineUrgency: "NONE",
      })
    ).toMatchObject({
      priority: "NORMAL",
      rule: "JOB_WITH_ACTION_NO_DEADLINE",
    });

    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.9,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      })
    ).toMatchObject({
      priority: "HIGH",
      rule: "JOB_WITH_ACTION_DEADLINE",
    });

    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.9,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "URGENT",
      })
    ).toMatchObject({
      priority: "URGENT",
      rule: "JOB_WITH_ACTION_URGENT_DEADLINE",
    });
  });
});
