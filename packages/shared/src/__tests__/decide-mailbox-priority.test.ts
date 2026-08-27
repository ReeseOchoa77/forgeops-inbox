import { describe, expect, it } from "vitest";

import {
  decideMailboxPriority,
  mapN8nPriorityToStored,
  mapStoredPriorityToN8n,
  N8N_JOB_PRIORITY_THRESHOLD,
  priorityDisplayLabel,
} from "../reference/priority-decision.js";

describe("decideMailboxPriority matrix", () => {
  it("jobReferenceConfidence = 0 → LOW", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "URGENT",
      }).priority
    ).toBe("LOW");
  });

  it("0.79 + action + urgent deadline → LOW", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.79,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "URGENT",
      })
    ).toMatchObject({
      priority: "LOW",
      rule: "NO_CONFIDENT_JOB_MATCH",
      jobRelated: false,
    });
  });

  it("0.80 + no action → LOW", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.8,
        containsActionRequest: false,
        hasExplicitDeadline: false,
        deadlineUrgency: "NONE",
      })
    ).toMatchObject({
      priority: "LOW",
      rule: "JOB_WITHOUT_ACTION_REQUEST",
      jobRelated: true,
      jobThreshold: N8N_JOB_PRIORITY_THRESHOLD,
    });
  });

  it("0.95 + no action + deadline → LOW", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.95,
        containsActionRequest: false,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      }).priority
    ).toBe("LOW");
  });

  it("0.80 + action + no deadline → NORMAL", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: false,
        deadlineUrgency: "NONE",
      })
    ).toMatchObject({
      priority: "NORMAL",
      rule: "JOB_WITH_ACTION_NO_DEADLINE",
    });
  });

  it("0.95 + action + no deadline → NORMAL", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.95,
        containsActionRequest: true,
        hasExplicitDeadline: false,
        deadlineUrgency: "NONE",
      }).priority
    ).toBe("NORMAL");
  });

  it("0.80 + action + STANDARD deadline → HIGH", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      })
    ).toMatchObject({
      priority: "HIGH",
      rule: "JOB_WITH_ACTION_DEADLINE",
    });
  });

  it("0.95 + action + STANDARD deadline → HIGH", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.95,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      }).priority
    ).toBe("HIGH");
  });

  it("0.80 + action + URGENT deadline → URGENT", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "URGENT",
      })
    ).toMatchObject({
      priority: "URGENT",
      rule: "JOB_WITH_ACTION_URGENT_DEADLINE",
    });
  });

  it("0.95 + action + URGENT deadline → URGENT", () => {
    expect(
      decideMailboxPriority({
        jobReferenceConfidence: 0.95,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "URGENT",
      }).priority
    ).toBe("URGENT");
  });
});

describe("NORMAL ↔ MEDIUM persistence boundary", () => {
  it("application NORMAL persists as MEDIUM", () => {
    expect(mapN8nPriorityToStored("NORMAL")).toBe("MEDIUM");
  });

  it("stored MEDIUM maps to application NORMAL for API/UI", () => {
    expect(mapStoredPriorityToN8n("MEDIUM")).toBe("NORMAL");
    expect(mapStoredPriorityToN8n("NORMAL")).toBe("NORMAL");
    expect(mapStoredPriorityToN8n(null)).toBeNull();
  });

  it("display labels use Normal not Medium", () => {
    expect(priorityDisplayLabel("NORMAL")).toBe("Normal");
    expect(priorityDisplayLabel("MEDIUM")).toBe("Normal");
    expect(priorityDisplayLabel(null)).toBe("Not set");
  });
});
