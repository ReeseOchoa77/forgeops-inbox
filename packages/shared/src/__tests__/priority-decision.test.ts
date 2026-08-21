import { describe, expect, it } from "vitest";
import {
  buildPriorityDecisionViewModel,
  computeN8nPriorityFromDecisionInputs,
  mapN8nPriorityToStored,
  mergeClassificationEvidenceForPersist,
  priorityDisplayLabel,
} from "../index.js";

describe("n8n priority decision contract (documentation — not used to override ingest)", () => {
  it("1. Job 79%, task yes, deadline yes → LOW", () => {
    expect(
      computeN8nPriorityFromDecisionInputs({
        jobReferenceConfidence: 0.79,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      })
    ).toBe("LOW");
  });

  it("2. Job 80%, task false → LOW", () => {
    expect(
      computeN8nPriorityFromDecisionInputs({
        jobReferenceConfidence: 0.8,
        containsActionRequest: false,
        hasExplicitDeadline: false,
        deadlineUrgency: "NONE",
      })
    ).toBe("LOW");
  });

  it("3. Job 80%, task true, no deadline → NORMAL / Medium", () => {
    const p = computeN8nPriorityFromDecisionInputs({
      jobReferenceConfidence: 0.8,
      containsActionRequest: true,
      hasExplicitDeadline: false,
      deadlineUrgency: "NONE",
    });
    expect(p).toBe("NORMAL");
    expect(priorityDisplayLabel(p)).toBe("Medium");
    expect(mapN8nPriorityToStored(p)).toBe("MEDIUM");
    expect(priorityDisplayLabel(mapN8nPriorityToStored(p))).toBe("Medium");
  });

  it("4. Job 80%, task true, standard deadline → HIGH", () => {
    expect(
      computeN8nPriorityFromDecisionInputs({
        jobReferenceConfidence: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      })
    ).toBe("HIGH");
  });

  it("5. Job 80%, task true, urgent deadline → URGENT", () => {
    expect(
      computeN8nPriorityFromDecisionInputs({
        jobReferenceConfidence: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "URGENT",
      })
    ).toBe("URGENT");
  });
});

describe("priorityDecision display + persistence", () => {
  it("6. Unknown/missing priorityDecision → historical behavior unchanged", () => {
    expect(
      buildPriorityDecisionViewModel({
        priority: "HIGH",
        evidence: { classificationDecision: { rule: "STRONG_BUSINESS_FLAG" } },
      })
    ).toBeNull();
    expect(buildPriorityDecisionViewModel({ priority: "MEDIUM", evidence: null })).toBeNull();
    expect(priorityDisplayLabel("MEDIUM")).toBe("Medium");
    expect(priorityDisplayLabel("HIGH")).toBe("High");
  });

  it("7. NORMAL continues rendering as Medium", () => {
    expect(priorityDisplayLabel("NORMAL")).toBe("Medium");
    expect(priorityDisplayLabel("MEDIUM")).toBe("Medium");
    expect(mapN8nPriorityToStored("NORMAL")).toBe("MEDIUM");
  });

  it("8. Priority explanation renders correctly for Email Review cases", () => {
    const lowNoJob = buildPriorityDecisionViewModel({
      priority: "LOW",
      priorityDecision: {
        rule: "NO_CONFIDENT_JOB_MATCH",
        jobRelated: false,
        jobReferenceConfidence: 0.34,
        jobThreshold: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      },
    });
    expect(lowNoJob).toMatchObject({
      displayLabel: "Low",
      reason: "No confident job match",
      jobConfidencePct: 34,
      jobThresholdPct: 80,
      showActionRequested: false,
      showDeadline: false,
    });

    const lowNoAction = buildPriorityDecisionViewModel({
      priority: "LOW",
      priorityDecision: {
        rule: "JOB_WITHOUT_ACTION_REQUEST",
        jobRelated: true,
        jobReferenceConfidence: 0.93,
        jobThreshold: 0.8,
        containsActionRequest: false,
        hasExplicitDeadline: false,
        deadlineUrgency: "NONE",
      },
    });
    expect(lowNoAction).toMatchObject({
      displayLabel: "Low",
      reason: "Job-related email with no action request",
      jobConfidencePct: 93,
      actionRequestedLabel: "No",
      showDeadline: false,
    });

    const medium = buildPriorityDecisionViewModel({
      priority: "MEDIUM",
      priorityDecision: {
        rule: "JOB_WITH_ACTION_NO_DEADLINE",
        jobRelated: true,
        jobReferenceConfidence: 0.92,
        jobThreshold: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: false,
        deadlineUrgency: "NONE",
      },
    });
    expect(medium).toMatchObject({
      displayLabel: "Medium",
      reason: "Job-related action with no deadline",
      jobConfidencePct: 92,
      actionRequestedLabel: "Yes",
      deadlineLabel: "None",
    });

    const high = buildPriorityDecisionViewModel({
      priority: "HIGH",
      priorityDecision: {
        rule: "JOB_WITH_ACTION_DEADLINE",
        jobRelated: true,
        jobReferenceConfidence: 0.94,
        jobThreshold: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      },
    });
    expect(high).toMatchObject({
      displayLabel: "High",
      reason: "Job-related action with deadline",
      deadlineLabel: "Yes",
    });

    const urgent = buildPriorityDecisionViewModel({
      priority: "URGENT",
      priorityDecision: {
        rule: "JOB_WITH_ACTION_URGENT_DEADLINE",
        jobRelated: true,
        jobReferenceConfidence: 0.96,
        jobThreshold: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "URGENT",
      },
    });
    expect(urgent).toMatchObject({
      displayLabel: "Urgent",
      reason: "Job-related action with urgent deadline",
      deadlineLabel: "Urgent",
    });
  });

  it("merges priorityDecision into classificationEvidence for persistence", () => {
    const merged = mergeClassificationEvidenceForPersist({
      classificationEvidence: { content: { probability: 0.9 } },
      classificationDecision: { rule: "STRONG_BUSINESS_FLAG" },
      priorityDecision: {
        rule: "JOB_WITH_ACTION_DEADLINE",
        jobReferenceConfidence: 0.94,
        jobThreshold: 0.8,
        containsActionRequest: true,
        hasExplicitDeadline: true,
        deadlineUrgency: "STANDARD",
      },
    });
    expect(merged?.priorityDecision).toMatchObject({
      rule: "JOB_WITH_ACTION_DEADLINE",
      jobReferenceConfidence: 0.94,
    });
    expect(merged?.classificationDecision).toMatchObject({
      rule: "STRONG_BUSINESS_FLAG",
    });
  });

  it("persists priorityDecision alone when no other evidence exists", () => {
    const merged = mergeClassificationEvidenceForPersist({
      classificationEvidence: null,
      priorityDecision: {
        rule: "NO_CONFIDENT_JOB_MATCH",
        jobReferenceConfidence: 0.2,
        jobThreshold: 0.8,
      },
    });
    expect(merged).toEqual({
      priorityDecision: {
        rule: "NO_CONFIDENT_JOB_MATCH",
        jobReferenceConfidence: 0.2,
        jobThreshold: 0.8,
      },
    });
  });
});
