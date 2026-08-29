import { describe, expect, it } from "vitest";
import {
  applyConfirmedJobAssociationOverride,
  buildJobCandidateMarker,
  CONFIRMED_JOB_ASSOCIATION_RULE,
  decideMailboxCategoryFlagsCumulative,
  resolveConfirmedWorkspaceJob,
  resolveInspectionJobMarkers,
} from "@forgeops/shared";

describe("confirmed job association → BUSINESS", () => {
  const personalDecision = decideMailboxCategoryFlagsCumulative({
    contentBusinessProbability: 0.2,
    subjectBusinessProbability: 0.2,
    jobReferenceConfidence: 0.1,
    senderStatus: "UNKNOWN",
  });

  it("valid workspace job forces BUSINESS over weaker PERSONAL signals", () => {
    expect(personalDecision.mailboxCategory).toBe("PERSONAL");
    const job = {
      id: "job1",
      jobNumber: "2209",
      name: "BSC BLDG. 3 Patio Rail",
    };
    const result = applyConfirmedJobAssociationOverride(
      personalDecision,
      job,
      "existing_message_job"
    );
    expect(result.mailboxCategory).toBe("BUSINESS");
    expect(result.overridden).toBe(true);
    expect(result.decisionRule).toBe(CONFIRMED_JOB_ASSOCIATION_RULE);
    expect(result.jobAssociation.status).toBe("CONFIRMED");
    expect(result.jobAssociation.decisionEffect).toContain("#2209");
    expect(result.classificationEvidence.decisionRule).toBe(
      CONFIRMED_JOB_ASSOCIATION_RULE
    );
  });

  it("job candidate alone is not confirmed business", () => {
    const candidate = buildJobCandidateMarker({
      jobReferenceConfidence: 0.96,
      explanation: "strong job ref",
      hintedJobId: "hint-1",
    });
    expect(candidate?.status).toBe("CANDIDATE");
    expect(personalDecision.mailboxCategory).toBe("PERSONAL");
  });

  it("cross-workspace jobId cannot trigger the rule", () => {
    expect(
      resolveConfirmedWorkspaceJob({
        workspaceId: "ws-a",
        job: {
          id: "job1",
          workspaceId: "ws-b",
          jobNumber: "1",
          name: "Other",
        },
      })
    ).toBeNull();
  });

  it("missing job cannot trigger the rule", () => {
    expect(
      resolveConfirmedWorkspaceJob({ workspaceId: "ws-a", job: null })
    ).toBeNull();
  });

  it("inspector distinguishes candidate vs confirmed; clears stale when no job", () => {
    const confirmed = resolveInspectionJobMarkers({
      evidence: {
        jobAssociation: {
          status: "CONFIRMED",
          jobId: "j1",
          jobNumber: "2209",
          name: "Rail",
          decisionEffect: "x → BUSINESS",
          source: "job_matcher",
          forcedDecision: true,
        },
        jobCandidate: {
          status: "CANDIDATE",
          confidencePct: 90,
          explanation: "ref",
          hintedJobId: null,
        },
      },
      linkedJob: { id: "j1", jobNumber: "2209", name: "Rail" },
    });
    expect(confirmed.jobAssociation.status).toBe("CONFIRMED");
    expect(confirmed.jobCandidate.status).toBe("CANDIDATE");

    const cleared = resolveInspectionJobMarkers({
      evidence: {
        jobAssociation: { status: "NONE" },
        jobCandidate: { status: "NONE" },
      },
      linkedJob: null,
    });
    expect(cleared.jobAssociation.status).toBe("NONE");
  });

  it("already-BUSINESS keeps original rule but records confirmed association", () => {
    const business = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.9,
      subjectBusinessProbability: 0.2,
      jobReferenceConfidence: 0.2,
      senderStatus: "UNKNOWN",
    });
    expect(business.mailboxCategory).toBe("BUSINESS");
    const result = applyConfirmedJobAssociationOverride(
      business,
      { id: "j1", jobNumber: "1", name: "Job" },
      "job_matcher"
    );
    expect(result.mailboxCategory).toBe("BUSINESS");
    expect(result.overridden).toBe(false);
    expect(result.decisionRule).toBe("STRONG_BUSINESS_FLAG");
    expect(result.jobAssociation.status).toBe("CONFIRMED");
  });
});
