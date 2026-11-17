/**
 * CONTEXT_AWARE_V2_5 — AI Identity Profiles (deterministic profile scoring).
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_5,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
  JOB_MATCH_V2_4_IMPLEMENTATION_REVISION,
  JOB_MATCH_V2_5_IMPLEMENTATION_REVISION,
  JOB_MATCH_V3_IMPLEMENTATION_REVISION,
  experimentRevisionForIdentityPolicy,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import {
  getJobMatchPolicyRegistryEntry,
  getProductionJobMatchIdentityPolicy,
  jobMatchPolicyAdvanceRank,
  listEvaluationSelectablePolicies,
} from "../jobs/job-match-policy-registry.js";
import {
  JOB_IDENTITY_PROFILE_VERSION,
  PROFILE_VERSION,
  buildDeterministicJobIdentityProfile,
  buildJobIdentityWorkspaceStats,
  buildWorkspaceIdentityProfiles,
  jobIdentityProfileSourceFingerprint,
  validateJobIdentityProfileAgainstTitle,
} from "../jobs/job-identity-profile.js";
import { resolveV25ProjectIdentity } from "../jobs/job-match-v25.js";
import { canonicalizeJobNameTokens } from "../jobs/job-name-normalize.js";
import type { IdentityPeerJob } from "../jobs/job-name-identity-policy.js";
import { runJobMatchPipeline } from "../jobs/job-match-pipeline.js";

const V25 = JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_5;

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
    customerId: extras?.customerId ?? "cust-a",
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

function peerFromName(j: JobRecordForMatch): IdentityPeerJob {
  const tokens = canonicalizeJobNameTokens(j.name);
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

function run(
  subject: string,
  jobs: JobRecordForMatch[],
  cleanBody = "",
  policy: Parameters<typeof runJobNameMarker>[0]["identityPolicy"] = V25
) {
  return runJobNameMarker({
    subject,
    cleanBody,
    jobs,
    identityPolicy: policy,
  });
}

const nova = job("job-nova", "Nova Classical");
const cpac = job("job-cpac", "CPAC Amphitheater");
const other = job("job-other", "Riverside Parking", { customerId: "cust-b" });

const beltB1 = job("job-belt-b1", "Beltline Bldg #1", { customerId: "cust-belt" });
const beltB2 = job("job-belt-b2", "Beltline Bldg #2", { customerId: "cust-belt" });
const beltB3 = job("job-belt-b3", "Beltline Bldg #3", { customerId: "cust-belt" });
const beltRamp = job("job-belt-ramp", "Beltline Parking Ramp", {
  customerId: "cust-belt",
});
const beltPool = [beltB1, beltB2, beltB3, beltRamp];

const satStairs = job("job-sat-stairs", "SAT - Exterior Stairs", { customerId: "cust-sat" });
const satConc = job("job-sat-conc", "SAT - Concessions", { customerId: "cust-sat" });
const satSteel = job("job-sat-steel", "SAT - Structural Steel", { customerId: "cust-sat" });
const satPool = [satStairs, satConc, satSteel];

describe("CONTEXT_AWARE_V2_5 identity profiles", () => {
  it("0. stamps revision, registers V2.5 at rank 8, production stays V2", () => {
    expect(JOB_MATCH_V2_5_IMPLEMENTATION_REVISION).toBe(
      "V2_5_AI_IDENTITY_PROFILES_R1"
    );
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2_5")).toBe(
      "V2_5_AI_IDENTITY_PROFILES_R1"
    );
    expect(PROFILE_VERSION).toBe("v25-identity-profile-r1");
    expect(JOB_IDENTITY_PROFILE_VERSION).toBe(PROFILE_VERSION);
    const entry = getJobMatchPolicyRegistryEntry("CONTEXT_AWARE_V2_5");
    expect(entry?.advanceRank).toBe(8);
    expect(entry?.displayName).toBe("V2.5 — AI Identity Profiles");
    expect(entry?.experimental).toBe(true);
    expect(entry?.availableForEvaluation).toBe(true);
    expect(entry?.productionDefault).toBe(false);
    expect(jobMatchPolicyAdvanceRank("CONTEXT_AWARE_V2_5")).toBeGreaterThan(
      jobMatchPolicyAdvanceRank("CONTEXT_AWARE_V3")
    );
    expect(getProductionJobMatchIdentityPolicy()).toBe(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
    expect(listEvaluationSelectablePolicies().map((p) => p.id)).toEqual([
      "CONTEXT_AWARE_V2",
      "CONTEXT_AWARE_V2_1",
      "CONTEXT_AWARE_V2_2",
      "CONTEXT_AWARE_V2_3",
      "CONTEXT_AWARE_V2_4",
      "CONTEXT_AWARE_V3",
      "CONTEXT_AWARE_V2_5",
    ]);
  });

  it("1. Nova → Nova Classical", () => {
    const r = run("Nova shop drawing revisions", [nova, other]);
    expect(r.selectedJobId).toBe("job-nova");
    expect(r.identityDiagnostics.reason).toBe("V25_DISTINCTIVE_TERM");
    const d = r.identityDiagnostics.v25Diagnostics!;
    expect(d.candidates[0]?.jobId).toBe("job-nova");
    expect(d.candidates[0]?.status).toBe("SELECTED");
    expect(d.termAnalyses.some((t) => t.term === "nova" && t.matched)).toBe(true);
  });

  it("2. CPAC → CPAC Amphitheater", () => {
    const r = run("CPAC update", [cpac, other]);
    expect(r.selectedJobId).toBe("job-cpac");
    expect(r.identityDiagnostics.reason).toBe("V25_DISTINCTIVE_TERM");
  });

  it("3. Beltline alone is ambiguous", () => {
    const r = run("Beltline project update", beltPool);
    expect(r.selectedJobId).toBeNull();
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.identityDiagnostics.reason).toBe("V25_SHARED_FAMILY_AMBIGUOUS");
    expect(r.ambiguousCandidateIds.sort()).toEqual(
      beltPool.map((j) => j.id).sort()
    );
  });

  it("4. Beltline Parking Ramp resolves", () => {
    const r = run("Beltline Parking Ramp shops", [...beltPool, other]);
    expect(r.selectedJobId).toBe("job-belt-ramp");
  });

  it("5. Beltline #3 → Bldg #3", () => {
    const r = run("Beltline #3 shops", beltPool);
    expect(r.selectedJobId).toBe("job-belt-b3");
    expect(r.identityDiagnostics.reason).toBe("V25_FAMILY_NUMERIC");
  });

  it("6. Beltline Bldg #3 resolves Bldg #3", () => {
    for (const subject of ["Beltline Bldg #3 shops", "Beltline Building 3 shops"]) {
      const r = run(subject, beltPool);
      expect(r.selectedJobId).toBe("job-belt-b3");
      expect(r.identityDiagnostics.reason).toBe("V25_FAMILY_DISAMBIGUATION");
    }
  });

  it("7. Beltline Bldg #2 does not match #3", () => {
    const r = run("Beltline Bldg #2 shops", beltPool);
    expect(r.selectedJobId).toBe("job-belt-b2");
    expect(r.selectedJobId).not.toBe("job-belt-b3");
    const rejected = r.identityDiagnostics.v25Diagnostics!.candidates.filter(
      (c) => c.status === "REJECTED"
    );
    expect(rejected.map((c) => c.jobId).sort()).toEqual([
      "job-belt-b1",
      "job-belt-b3",
    ]);
  });

  it("7b. Beltline Bldg #7 (no such building) is a numeric conflict", () => {
    const r = run("Beltline Bldg #7 shops", beltPool);
    expect(r.selectedJobId).toBeNull();
    expect(r.identityDiagnostics.reason).toBe("V25_NUMERIC_CONFLICT");
    expect(r.identityDiagnostics.identityStrength).toBe("CONFLICTING");
  });

  it("8. Three drawings / open RFIs do not identify Building 3", () => {
    const r1 = run("Beltline project update", beltPool, "We attached 3 drawings.");
    expect(r1.selectedJobId).toBeNull();
    const r2 = run("Beltline status", beltPool, "Beltline has 3 open RFIs.");
    expect(r2.selectedJobId).toBeNull();
    const r3 = run("Beltline 3 drawings", beltPool);
    expect(r3.selectedJobId).not.toBe("job-belt-b3");
  });

  it("9. SAT alone is ambiguous", () => {
    const r = run("SAT shop drawing revisions", satPool);
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.selectedJobId).toBeNull();
  });

  it("10. SAT + concessions resolves Concessions", () => {
    const r = run("SAT concessions update", satPool);
    expect(r.selectedJobId).toBe("job-sat-conc");
    // V2 already resolves the explicit phrase; V2.5 only recovers V2 abstentions.
    const stairs = run("SAT stairs", satPool);
    expect(stairs.selectedJobId).toBe("job-sat-stairs");
    expect(stairs.identityDiagnostics.reason).toBe("V25_FAMILY_DISAMBIGUATION");
  });

  it("11. Generic construction words alone cannot resolve", () => {
    const r = run("Structural steel shop drawings", satPool);
    expect(r.selectedJobId).toBeNull();
    const r2 = run("Bldg shop drawings", beltPool);
    expect(r2.selectedJobId).toBeNull();
    const r3 = run("Parking stairs deck", [...beltPool, other, ...satPool]);
    expect(r3.selectedJobId).toBeNull();
  });

  it("12. Full job name is a strong match", () => {
    const r = run("Re: Nova Classical - revised shops", [nova, other]);
    expect(r.selectedJobId).toBe("job-nova");
    const r2 = run("Beltline Parking Ramp", beltPool);
    expect(r2.selectedJobId).toBe("job-belt-ramp");
  });

  it("13. Body Beltline Bldg #2 with generic subject", () => {
    const r = run(
      "Hourly summary: 1 item requiring your attention",
      beltPool,
      "Frana Companies, Inc • Beltline – Bldg #2"
    );
    expect(r.selectedJobId).toBe("job-belt-b2");
    expect(r.identityDiagnostics.v25Diagnostics?.status).toBe("MATCH");
  });

  it("14. Removed Jobs remain excluded", () => {
    const removed = job("job-nova-removed", "Nova Classical", {
      archivedAt: new Date("2024-01-01"),
    });
    const r = run("Nova update", [nova, removed]);
    expect(r.selectedJobId).toBe("job-nova");
    const r2 = run("Nova update", [removed]);
    expect(r2.selectedJobId).not.toBe("job-nova-removed");
  });

  it("15. Unawarded active bids remain excluded", () => {
    const bidding = job("job-nova-bid", "Nova Classical", { status: "BIDDING" });
    const r = run("Nova update", [nova, bidding]);
    expect(r.selectedJobId).toBe("job-nova");
    const r2 = run("Nova update", [bidding, other]);
    expect(r2.selectedJobId).not.toBe("job-nova-bid");
  });

  it("16. Internal job numbers are not matching evidence", () => {
    const withNum = job("job-nova-num", "Nova Classical", { jobNumber: "77441" });
    const r = run("Regarding 77441", [withNum, other], "Please advise.");
    expect(r.selectedJobId).not.toBe("job-nova-num");
    const d = r.identityDiagnostics.v25Diagnostics;
    expect(d?.termAnalyses.some((t) => t.term.includes("77441")) ?? false).toBe(
      false
    );
  });

  it("17. Incidental body mention does not assign", () => {
    const r = run(
      "Coordination notes",
      [nova, other],
      "Nova was mentioned as an example from another project. Please review Riverside Parking shops."
    );
    expect(r.selectedJobId).not.toBe("job-nova");
  });

  it("18. Negated mention does not assign", () => {
    const r = run("Coordination notes", [nova, other], "This is not Nova related.");
    expect(r.selectedJobId).not.toBe("job-nova");
  });

  it("19. Quoted history does not override current identity", () => {
    const r = run(
      "Beltline #2 shops",
      beltPool,
      [
        "Please review.",
        "",
        "On Mon, someone wrote:",
        "> Regarding Beltline #1 from last month",
      ].join("\n")
    );
    expect(r.selectedJobId).toBe("job-belt-b2");
  });

  it("20. V2 baseline unchanged: no V2.5 diagnostics, null revision", () => {
    const r = run(
      "Nova shop drawing revisions",
      [nova, other],
      "",
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
    expect(r.identityDiagnostics.v25Diagnostics).toBeUndefined();
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2")).toBeNull();
    // V2 alone abstains on the unique-weak case that V2.5 recovers.
    expect(r.selectedJobId).toBeNull();
    const v2Belt = run(
      "Beltline #3 shops",
      beltPool,
      "",
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
    expect(v2Belt.selectedJobId).toBeNull();
    expect(run("Beltline #3 shops", beltPool).selectedJobId).toBe("job-belt-b3");
  });

  it("21. V2.4 / V3 behavior and stamps are unaffected", () => {
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2_4")).toBe(
      JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
    );
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V3")).toBe(
      JOB_MATCH_V3_IMPLEMENTATION_REVISION
    );
    for (const p of [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    ]) {
      const r = run("Beltline #3 shops", beltPool, "", p);
      expect(r.identityDiagnostics.v25Diagnostics).toBeUndefined();
    }
    // V2.4 still cannot resolve Beltline #3 (V3-only feature) — unchanged.
    const v24 = run(
      "Beltline #3 shops",
      beltPool,
      "",
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4
    );
    expect(v24.selectedJobId).toBeNull();
  });

  it("22. Profiles are deterministic and carry roles", () => {
    const jobs = [...beltPool, other].map((j) => ({
      jobId: j.id,
      jobName: j.name,
    }));
    const a = buildWorkspaceIdentityProfiles({ jobs });
    const b = buildWorkspaceIdentityProfiles({ jobs });
    expect(JSON.stringify([...a.entries()])).toBe(
      JSON.stringify([...b.entries()])
    );
    const ramp = a.get("job-belt-ramp")!;
    const role = (t: string) => ramp.terms.find((x) => x.term === t)?.role;
    expect(ramp.profileVersion).toBe("v25-identity-profile-r1");
    expect(role("beltline")).toBe("PROJECT_FAMILY_NAME");
    expect(role("parking")).toBe("STRUCTURE_DESCRIPTOR");
    expect(role("parking ramp")).toBe("COMPOUND_PROJECT_PHRASE");
    expect(a.get("job-belt-b3")!.terms.find((t) => t.term === "building:3")?.role).toBe(
      "NUMBERED_STRUCTURE_IDENTIFIER"
    );

    const novaProfile = buildWorkspaceIdentityProfiles({
      jobs: [
        { jobId: "n", jobName: "Nova Classical" },
        { jobId: "o", jobName: "Riverside Parking" },
        { jobId: "s", jobName: "Structural Steel Shop" },
      ],
    }).get("n")!;
    expect(novaProfile.terms.find((t) => t.term === "nova")).toMatchObject({
      role: "DISTINCTIVE_PROJECT_NAME",
      semanticImportance: "HIGH",
      competitiveImportance: "HIGH",
      documentFrequency: 1,
    });
    const steel = buildWorkspaceIdentityProfiles({
      jobs: [{ jobId: "s", jobName: "Structural Steel Shop" }],
    }).get("s")!;
    expect(steel.terms.find((t) => t.term === "steel")?.role).toBe(
      "GENERIC_CONSTRUCTION_TERM"
    );
    expect(steel.terms.every((t) => !/^\d+$/.test(t.term))).toBe(true);
  });

  it("23. Profile validation rejects invented / bare-number / generic-as-name terms", () => {
    const input = { jobId: "n", jobName: "Nova Classical" };
    const stats = buildJobIdentityWorkspaceStats([input]);
    const good = buildDeterministicJobIdentityProfile(input, stats);
    expect(validateJobIdentityProfileAgainstTitle(good, input).ok).toBe(true);
    expect(good.sourceFingerprint).toBe(jobIdentityProfileSourceFingerprint(input));

    const invented = {
      ...good,
      terms: [
        ...good.terms,
        { ...good.terms[0]!, term: "zebra", tokens: ["zebra"] },
      ],
    };
    expect(validateJobIdentityProfileAgainstTitle(invented, input).ok).toBe(false);

    const bare = {
      ...good,
      terms: [{ ...good.terms[0]!, term: "3", tokens: ["3"] }],
    };
    expect(validateJobIdentityProfileAgainstTitle(bare, input).ok).toBe(false);

    const steelInput = { jobId: "s", jobName: "Nova Steel" };
    const steelProfile = buildDeterministicJobIdentityProfile(
      steelInput,
      buildJobIdentityWorkspaceStats([steelInput])
    );
    const mislabeled = {
      ...steelProfile,
      terms: steelProfile.terms.map((t) =>
        t.term === "steel" ? { ...t, role: "DISTINCTIVE_PROJECT_NAME" as const } : t
      ),
    };
    expect(validateJobIdentityProfileAgainstTitle(mislabeled, steelInput).ok).toBe(
      false
    );
  });

  it("24. resolveV25ProjectIdentity works without supplied profiles and falls back on invalid ones", () => {
    const peers = beltPool.map(peerFromName);
    const subjectTokens = canonicalizeJobNameTokens("Beltline #3 shops");
    const none = resolveV25ProjectIdentity({
      peers,
      subjectTokens,
      bodyTokens: [],
    });
    expect(none.status).toBe("MATCH");
    expect(none.selectedJobId).toBe("job-belt-b3");
    expect(none.profileSource).toBe("DETERMINISTIC");
    expect(none.winnerScore).toBeGreaterThan(0);

    const bad = {
      jobId: "job-belt-b3",
      profileVersion: "old",
      jobName: "x",
      sourceFingerprint: "x",
      analysisStatus: "READY" as const,
      source: "LLM" as const,
      terms: [],
    };
    const withBad = resolveV25ProjectIdentity({
      peers,
      subjectTokens,
      bodyTokens: [],
      profilesByJobId: new Map([["job-belt-b3", bad]]),
    });
    expect(withBad.selectedJobId).toBe("job-belt-b3");
    expect(withBad.fallbackProfileJobIds).toEqual(["job-belt-b3"]);

    const supplied = buildWorkspaceIdentityProfiles({
      jobs: peers.map((p) => ({ jobId: p.jobId, phraseTokenLists: p.phraseTokenLists })),
    });
    const withGood = resolveV25ProjectIdentity({
      peers,
      subjectTokens,
      bodyTokens: [],
      profilesByJobId: supplied,
    });
    expect(withGood.profileSource).toBe("SUPPLIED");
    expect(withGood.selectedJobId).toBe("job-belt-b3");

    // No identity evidence → fallback reason, no status.
    const nothing = resolveV25ProjectIdentity({
      peers,
      subjectTokens: canonicalizeJobNameTokens("weekly report"),
      bodyTokens: [],
    });
    expect(nothing.status).toBeNull();
    expect(nothing.reason).toBe("V25_PROFILE_FALLBACK");
  });

  it("25. Scores are bounded evidence scores with candidate/term diagnostics", () => {
    const r = run("Beltline #3 shops", beltPool);
    const d = r.identityDiagnostics.v25Diagnostics!;
    expect(d.scoringRevision).toBe("v25-scoring-r1");
    expect(d.candidates.length).toBeGreaterThan(1);
    const sel = d.candidates.find((c) => c.status === "SELECTED")!;
    expect(sel.score).toBeCloseTo(sel.familyScore + sel.distinguishingScore, 2);
    expect(d.margin).toBeGreaterThanOrEqual(0.35);
    expect(
      d.termAnalyses.every(
        (t) =>
          typeof t.documentFrequency === "number" &&
          ["subject", "body", "attachment"].includes(t.source)
      )
    ).toBe(true);
    expect(() => JSON.stringify(d)).not.toThrow();
  });

  it("26. Full pipeline accepts V2.5 and keeps production default V2", () => {
    const result = runJobMatchPipeline({
      subject: "Nova shop drawing revisions",
      cleanBody: "",
      jobs: [nova, other],
      identityPolicy: V25,
    });
    expect(result.identityPolicy).toBe(V25);
    expect(result.selectedJobId).toBe("job-nova");
  });
});
