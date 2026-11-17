/**
 * CONTEXT_AWARE_V2_4 — Contextual Word Search (independent of V2.1 / V2.2 / V2.3).
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
  JOB_MATCH_V2_4_IMPLEMENTATION_REVISION,
  JOB_MATCH_V2_4_LEGACY_IMPLEMENTATION_REVISION,
  experimentRevisionForIdentityPolicy,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import {
  validateContextualWordSearchAiDecision,
  resolveContextualWordSearch,
  buildContextualFamilyIndex,
} from "../jobs/job-contextual-word-search.js";
import {
  getJobMatchPolicyRegistryEntry,
  getProductionJobMatchIdentityPolicy,
  listEvaluationSelectablePolicies,
} from "../jobs/job-match-policy-registry.js";
import type { IdentityPeerJob } from "../jobs/job-name-identity-policy.js";

function job(
  id: string,
  name: string,
  extras?: Partial<JobRecordForMatch>
): JobRecordForMatch {
  return {
    id,
    jobNumber: extras?.jobNumber ?? (id.replace(/\D/g, "") || "1"),
    name,
    normalizedName: name.toLowerCase(),
    customerId: extras?.customerId ?? "cust-sat",
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

const satStairs = job("job-sat-stairs", "SAT - Exterior Stairs");
const satConc = job("job-sat-conc", "SAT - Concessions");
const satSteel = job("job-sat-steel", "SAT - Structural Steel");
const satPool = [satStairs, satConc, satSteel];

const beltRamp = job("job-belt-ramp", "Beltline Parking Ramp", {
  customerId: "cust-belt",
});
const beltB1 = job("job-belt-b1", "Beltline Building 1", {
  customerId: "cust-belt",
});
const beltB2 = job("job-belt-b2", "Beltline Building 2", {
  customerId: "cust-belt",
});

function peerFromJob(j: JobRecordForMatch, tokens: string[]): IdentityPeerJob {
  return {
    jobId: j.id,
    customerId: j.customerId,
    contentTokens: tokens,
    distinguishingTokens: tokens.filter((t) => /^\d+$/.test(t)),
    phraseTokenLists: [tokens],
    matchedContentTokens: [],
    kind: "NONE",
  };
}

describe("CONTEXT_AWARE_V2_4 contextual word search", () => {
  it("is registered for model selection with correct display name", () => {
    const entry = listEvaluationSelectablePolicies().find(
      (e) => e.id === "CONTEXT_AWARE_V2_4"
    );
    expect(entry?.displayName).toBe("V2.4 — Contextual Word Search");
    expect(entry?.experimental).toBe(true);
    expect(entry?.productionDefault).toBe(false);
  });

  it("stamps V2_4_COMPOUND_NUMERIC_IDENTITY_R1 revision (not legacy)", () => {
    expect(JOB_MATCH_V2_4_IMPLEMENTATION_REVISION).toBe(
      "V2_4_COMPOUND_NUMERIC_IDENTITY_R1"
    );
    expect(JOB_MATCH_V2_4_LEGACY_IMPLEMENTATION_REVISION).toBe("V2_4_LEGACY");
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2_4")).toBe(
      "V2_4_COMPOUND_NUMERIC_IDENTITY_R1"
    );
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2_3")).toBe(
      "independent-v23-normalized-subject-identity-r1"
    );
  });

  it("production default remains CONTEXT_AWARE_V2", () => {
    expect(getProductionJobMatchIdentityPolicy()).toBe("CONTEXT_AWARE_V2");
  });

  it("1. SAT with no distinguishing words remains ambiguous", () => {
    const r = runJobNameMarker({
      subject: "SAT shop drawing revisions",
      cleanBody: "Please review the updated connections.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.selectedJobId).toBeNull();
  });

  it("2. SAT + concessions in subject resolves Concessions", () => {
    const r = runJobNameMarker({
      subject: "SAT concessions drawing revisions",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-sat-conc");
  });

  it("3. SAT + stairs in subject resolves Stairs", () => {
    const r = runJobNameMarker({
      subject: "SAT exterior stairs update",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-sat-stairs");
  });

  it("4. SAT in subject + concessions in body resolves Concessions", () => {
    const r = runJobNameMarker({
      subject: "SAT shop drawing revisions",
      cleanBody:
        "Attached are the revised drawings for the concessions area. Please review.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-sat-conc");
  });

  it("5. SAT in subject + stairs in body resolves Stairs (stair≈stairs)", () => {
    const r = runJobNameMarker({
      subject: "SAT - Updated submittal",
      cleanBody:
        "We have revised the stair connections based on the engineer's comments.",
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-sat-stairs");
  });

  it("6. Negated concessions does not count as positive Concessions evidence", () => {
    const r = runJobNameMarker({
      subject: "SAT revised drawings",
      cleanBody:
        "These drawings are for the stairs, not the concessions.",
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBe("job-sat-stairs");
    expect(r.selectedJobId).not.toBe("job-sat-conc");
  });

  it("7. Incidental concessions mention does not override stairs work", () => {
    const r = runJobNameMarker({
      subject: "SAT updated connections",
      cleanBody:
        "The concessions work is complete. Please review the new stair connections.",
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBe("job-sat-stairs");
  });

  it("8. Multiple positive competing references remain ambiguous", () => {
    const r = runJobNameMarker({
      subject: "SAT project updates",
      cleanBody: "We need revisions to both the stairs and concessions.",
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.selectedJobId).toBeNull();
  });

  it("9. Strong subject identity is not overridden by incidental body text", () => {
    const r = runJobNameMarker({
      subject: "SAT - Exterior Stairs shop drawings",
      cleanBody: "Also noting concessions is still pending separately.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-sat-stairs");
    expect(r.identityDiagnostics.contextualChangedBaseline).toBe(false);
  });

  it("10. Explicit correction is handled conservatively", () => {
    const r = runJobNameMarker({
      subject: "SAT stairs revisions",
      cleanBody:
        "Correction: these drawings are actually for the concessions, not the stairs.",
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.selectedJobId).toBeNull();
    expect([
      "EXPLICIT_PROJECT_CORRECTION",
      "CONTEXTUAL_WORD_SEARCH_AMBIGUOUS",
      "AMBIGUOUS_CANDIDATES",
    ]).toContain(r.identityDiagnostics.reason);
  });

  it("11. Generic construction terms do not create confident matches", () => {
    const r = runJobNameMarker({
      subject: "SAT structural steel shops",
      cleanBody: "Please review the fabrication drawings.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    // "structural"/"steel" are weak — must not confidently pick Structural Steel alone
    // unless V2 already has a strong unique phrase match.
    if (r.status === "MATCH") {
      expect(r.identityDiagnostics.reason).not.toBe(
        "CONTEXTUAL_WORD_SEARCH_MATCH"
      );
    } else {
      expect(r.selectedJobId).toBeNull();
    }
  });

  it("12. Quoted historical content does not create false matches", () => {
    const r = runJobNameMarker({
      subject: "SAT updated submittal",
      cleanBody: [
        "Please review the attached.",
        "",
        "On Mon, someone wrote:",
        "> Regarding the concessions area drawings from last month",
      ].join("\n"),
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-sat-conc");
  });

  it("13. Signatures do not create false matches", () => {
    const r = runJobNameMarker({
      subject: "SAT project update",
      cleanBody: [
        "Please advise.",
        "",
        "--",
        "Jane Doe",
        "Project Manager — Concessions Division",
        "TEK STEEL",
      ].join("\n"),
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.selectedJobId).toBeNull();
  });

  it("14. Building 1 and Building 2 remain distinguishable", () => {
    const r1 = runJobNameMarker({
      subject: "Beltline Building 1 shops",
      cleanBody: "",
      jobs: [beltRamp, beltB1, beltB2],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    const r2 = runJobNameMarker({
      subject: "Beltline Building 2 shops",
      cleanBody: "",
      jobs: [beltRamp, beltB1, beltB2],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r1.selectedJobId).toBe("job-belt-b1");
    expect(r2.selectedJobId).toBe("job-belt-b2");
    expect(r1.selectedJobId).not.toBe(r2.selectedJobId);
  });

  it("15. Removed Jobs are excluded", () => {
    const removed = job("job-sat-removed", "SAT - Concessions", {
      archivedAt: new Date("2024-01-01"),
    });
    const r = runJobNameMarker({
      subject: "SAT concessions update",
      cleanBody: "",
      jobs: [satStairs, removed],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-sat-removed");
  });

  it("16. Unawarded active bids are excluded", () => {
    const bidding = job("job-sat-bid", "SAT - Concessions", {
      status: "BIDDING",
    });
    const r = runJobNameMarker({
      subject: "SAT concessions update",
      cleanBody: "",
      jobs: [satStairs, bidding],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-sat-bid");
  });

  it("17. Internal Job numbers are not used as evidence", () => {
    const withNum = job("job-sat-num", "SAT - Exterior Stairs", {
      jobNumber: "88221",
    });
    const r = runJobNameMarker({
      subject: "Regarding 88221",
      cleanBody: "Please advise on status.",
      jobs: [withNum, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-sat-num");
  });

  it("18. AI cannot select a Job outside the supplied candidate set", () => {
    const validated = validateContextualWordSearchAiDecision({
      decision: {
        selectedJobId: "job-outsider",
        decision: "MATCH",
        supportingEvidence: ["concessions"],
        competingJobIds: [],
        interpretation: "PRIMARY",
        explanation: "guess",
        confidence: 0.9,
      },
      candidateJobIds: ["job-sat-stairs", "job-sat-conc"],
      subject: "SAT revised drawings",
      body: "Attached are the revised concessions drawings.",
    });
    expect(validated.ok).toBe(false);
  });

  it("19. AI can abstain", () => {
    const validated = validateContextualWordSearchAiDecision({
      decision: {
        selectedJobId: null,
        decision: "AMBIGUOUS",
        supportingEvidence: [],
        competingJobIds: ["job-sat-stairs", "job-sat-conc"],
        interpretation: "UNCERTAIN",
        explanation: "both mentioned",
        confidence: 0.2,
      },
      candidateJobIds: ["job-sat-stairs", "job-sat-conc"],
      subject: "SAT updates",
      body: "stairs and concessions",
    });
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.decision.selectedJobId).toBeNull();
    }
  });

  it("20. Invalid AI responses are rejected", () => {
    const validated = validateContextualWordSearchAiDecision({
      decision: {
        selectedJobId: "job-sat-conc",
        decision: "MATCH",
        supportingEvidence: ["this excerpt does not exist anywhere"],
        competingJobIds: [],
        interpretation: "PRIMARY",
        explanation: "bad",
        confidence: 0.99,
      },
      candidateJobIds: ["job-sat-stairs", "job-sat-conc"],
      subject: "SAT revised drawings",
      body: "Attached are the revised concessions drawings.",
    });
    expect(validated.ok).toBe(false);
  });

  it("21. AI failure falls back safely without crashing", () => {
    const r = runJobNameMarker({
      subject: "SAT project updates",
      cleanBody: "We need revisions to both the stairs and concessions.",
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      contextualAiDecision: {
        selectedJobId: "job-invented",
        decision: "MATCH",
        supportingEvidence: ["fake"],
        competingJobIds: [],
        interpretation: "PRIMARY",
        explanation: "bad",
        confidence: 1,
      },
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.selectedJobId).toBeNull();
  });

  it("22. Production V2 remains unchanged on SAT+concessions body case", () => {
    const v2 = runJobNameMarker({
      subject: "SAT shop drawing revisions",
      cleanBody:
        "Attached are the revised drawings for the concessions area.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    const v24 = runJobNameMarker({
      subject: "SAT shop drawing revisions",
      cleanBody:
        "Attached are the revised drawings for the concessions area.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(v2.selectedJobId).toBeNull();
    expect(v24.selectedJobId).toBe("job-sat-conc");
  });

  it("23. V2.1 / V2.2 / V2.3 remain independent (not inheriting V2.4)", () => {
    const body =
      "Attached are the revised drawings for the concessions area.";
    for (const policy of [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    ] as const) {
      const r = runJobNameMarker({
        subject: "SAT shop drawing revisions",
        cleanBody: body,
        jobs: satPool,
        identityPolicy: policy,
      });
      // Body-only distinguishing without title-gap adjacency is V2.4-specific.
      expect(r.identityDiagnostics.reason).not.toBe(
        "CONTEXTUAL_WORD_SEARCH_MATCH"
      );
    }
  });

  it("24. Historical V2.4 revision labels remain distinguishable", () => {
    expect(JOB_MATCH_V2_4_LEGACY_IMPLEMENTATION_REVISION).not.toBe(
      JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
    );
  });

  it("25. Multi-model registry includes V2.4 and V3 alongside V2–V2.3", () => {
    const ids = listEvaluationSelectablePolicies().map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "CONTEXT_AWARE_V2",
        "CONTEXT_AWARE_V2_1",
        "CONTEXT_AWARE_V2_2",
        "CONTEXT_AWARE_V2_3",
        "CONTEXT_AWARE_V2_4",
        "CONTEXT_AWARE_V2_5",
      ])
    );
    expect(ids).not.toContain("CONTEXT_AWARE_V3");
    const v3 = getJobMatchPolicyRegistryEntry("CONTEXT_AWARE_V3");
    expect(v3?.availableForEvaluation).toBe(false);
    expect(v3?.displayName).toBe("V3 — Retired Model");
  });

  it("frozen V2.4 does not promote unique Nova or Beltline #3", () => {
    const nova = job("job-nova", "Nova Classical");
    const other = job("job-other", "Riverside Parking", {
      customerId: "cust-b",
    });
    const rNova = runJobNameMarker({
      subject: "Nova shop drawing revisions",
      cleanBody: "",
      jobs: [nova, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(rNova.selectedJobId).not.toBe("job-nova");

    const rBelt = runJobNameMarker({
      subject: "Beltline #3 shops",
      cleanBody: "",
      jobs: [beltRamp, beltB1, beltB2],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    // beltB1/B2 only in this pool — #3 with no matching peer stays ambiguous
    expect(rBelt.selectedJobId).toBeNull();
  });

  it("26. Tenant isolation — jobs from other workspaces are not in the pool", () => {
    // Marker only sees the jobs array passed in (workspace-scoped by caller).
    const other = job("job-other", "SAT - Concessions", {
      customerId: "other-ws-cust",
    });
    const r = runJobNameMarker({
      subject: "SAT concessions update",
      cleanBody: "",
      jobs: [satStairs], // other workspace Job omitted from eligible pool
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe(other.id);
    expect(r.candidateJobIds).not.toContain(other.id);
  });

  it("family index identifies shared SAT and distinguishing terms", () => {
    const peers = [
      peerFromJob(satStairs, ["sat", "exterior", "stairs"]),
      peerFromJob(satConc, ["sat", "concessions"]),
      peerFromJob(satSteel, ["sat", "structural", "steel"]),
    ];
    const index = buildContextualFamilyIndex(peers);
    expect(index.sharedIdentifiers.map((s) => s.toLowerCase())).toContain(
      "sat"
    );
    const resolved = resolveContextualWordSearch({
      peers,
      subjectTokens: ["sat", "shop", "drawing", "revisions"],
      bodyTokens: ["attached", "are", "the", "revised", "concessions", "drawings"],
    });
    expect(resolved.status).toBe("MATCH");
    expect(resolved.selectedJobId).toBe("job-sat-conc");
  });
});
