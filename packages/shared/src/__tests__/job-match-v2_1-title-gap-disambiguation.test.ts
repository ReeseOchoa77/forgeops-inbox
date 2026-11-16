/**
 * V2.1 title-gap: shared project identifiers require distinguishing title evidence.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import {
  distinguishingTitleEvidenceInRun,
  isWeakTitleDisambiguationToken,
  type IdentityPeerJob,
} from "../jobs/job-name-identity-policy.js";

function job(
  id: string,
  name: string,
  extras?: Partial<JobRecordForMatch>
): JobRecordForMatch {
  return {
    id,
    jobNumber: id.replace(/\D/g, "") || "1",
    name,
    normalizedName: name.toLowerCase(),
    customerId: null,
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

const satStairs = job("job-sat-stairs", "SAT - Exterior Stairs", {
  customerId: "cust-sat",
});
const satConc = job("job-sat-conc", "SAT - Concessions", {
  customerId: "cust-sat",
});
const satSteel = job("job-sat-steel", "SAT - Structural Steel", {
  customerId: "cust-sat",
});
const satPool = [satStairs, satConc, satSteel];

describe("V2.1 shared-identifier title-gap disambiguation", () => {
  it("SAT alone with multiple eligible Jobs → Ambiguous", () => {
    const v21 = runJobNameMarker({
      subject: "SAT project update",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("AMBIGUOUS");
    expect(v21.selectedJobId).toBeNull();
    expect([
      "INSUFFICIENT_DISAMBIGUATION",
      "SHARED_PROJECT_IDENTIFIER",
      "ACRONYM_AMBIGUITY",
      "SHARED_CUSTOMER_IDENTITY",
      "INSUFFICIENT_PROJECT_DISAMBIGUATION",
      "NON_CONTIGUOUS_TOKEN_OVERLAP",
      "GENERIC_TERM_ONLY",
      "AMBIGUOUS_CANDIDATES",
    ]).toContain(v21.identityDiagnostics.reason);
  });

  it("SAT + stairs → Exterior Stairs", () => {
    const v21 = runJobNameMarker({
      subject: "SAT updated stairs drawings",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-stairs");
    expect(v21.identityDiagnostics.reason).toBe("DISTINGUISHING_TITLE_EVIDENCE");
    expect(v21.identityDiagnostics.distinguishingIdentityTerms.length).toBeGreaterThan(
      0
    );
  });

  it("SAT + concessions → Concessions", () => {
    const v21 = runJobNameMarker({
      subject: "SAT concessions revisions",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
    // May resolve via production V2 distinctive phrase or V2.1 distinguishing title-gap.
    expect([
      "DISTINGUISHING_TITLE_EVIDENCE",
      "DISTINCTIVE_PROJECT_PHRASE",
      "UNIQUE_PROJECT_PHRASE",
      "GAP_TOLERANT_PROJECT_MATCH",
    ]).toContain(v21.identityDiagnostics.reason);
  });

  it("SAT + generic steel → Ambiguous", () => {
    const v21 = runJobNameMarker({
      subject: "SAT steel update",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.selectedJobId).toBeNull();
    expect(v21.status).toBe("AMBIGUOUS");
    expect(isWeakTitleDisambiguationToken("steel")).toBe(true);
  });

  it("SAT + project update → Ambiguous", () => {
    const v21 = runJobNameMarker({
      subject: "SAT project update",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.selectedJobId).toBeNull();
    expect(v21.status).toBe("AMBIGUOUS");
  });

  it("SAT + stairs + concessions → Ambiguous / competing evidence", () => {
    // Subject chosen so production V2 abstains; V2.1 title-gap then sees
    // distinguishing evidence for multiple shared-identifier peers.
    const v21 = runJobNameMarker({
      subject:
        "Regarding the SAT job — exterior access stairs and also the concessions area",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.selectedJobId).toBeNull();
    expect(v21.status).toBe("AMBIGUOUS");
    expect([
      "COMPETING_TITLE_EVIDENCE",
      "CONTRADICTORY_PROJECT_EVIDENCE",
      "CONFLICTING_STRONG_IDENTITIES",
      "INSUFFICIENT_DISAMBIGUATION",
      "INSUFFICIENT_PROJECT_DISAMBIGUATION",
      "SHARED_CUSTOMER_IDENTITY",
    ]).toContain(v21.identityDiagnostics.reason);
  });

  it("gap-tolerant matching preserves token order across intervening words", () => {
    const v21 = runJobNameMarker({
      subject: "SAT updated stairs drawings",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-stairs");
    expect(v21.identityDiagnostics.reason).toBe("DISTINGUISHING_TITLE_EVIDENCE");
    expect(v21.identityDiagnostics.tokenDistance ?? 0).toBeGreaterThan(0);
  });

  it("removed Jobs do not create false competition", () => {
    const removedStairs = job("job-sat-stairs-gone", "SAT - Exterior Stairs", {
      customerId: "cust-sat",
      archivedAt: new Date("2024-01-01"),
    });
    const v21 = runJobNameMarker({
      subject: "SAT concessions revisions",
      cleanBody: "",
      jobs: [satConc, satSteel, removedStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
  });

  it("unawarded / ineligible bid Jobs do not create false competition", () => {
    const bidStairs = job("job-sat-bid", "SAT - Exterior Stairs", {
      customerId: "cust-sat",
      status: "BIDDING",
    });
    const v21 = runJobNameMarker({
      subject: "SAT concessions revisions",
      cleanBody: "",
      jobs: [satConc, satSteel, bidStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
  });

  it("production V2 confident contiguous assignment remains unchanged", () => {
    const v2 = runJobNameMarker({
      subject: "SAT - Concessions shop drawings",
      cleanBody: "",
      jobs: [satConc, satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    const v21 = runJobNameMarker({
      subject: "SAT - Concessions shop drawings",
      cleanBody: "",
      jobs: [satConc, satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v2.status).toBe("MATCH");
    expect(v2.selectedJobId).toBe("job-sat-conc");
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
  });

  it("V2.2 unique-token behavior remains unchanged", () => {
    const v22 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.status).toBe("MATCH");
    expect(v22.selectedJobId).toBe("job-sat-stairs");
    expect(v22.identityDiagnostics.reason).toBe("UNIQUE_PROJECT_TOKEN");
  });

  it("does not use internal Job numbers as prediction evidence", () => {
    const numbered = job("job-sat-num", "SAT - Exterior Stairs", {
      customerId: "cust-sat",
      jobNumber: "2416",
    });
    const v21 = runJobNameMarker({
      subject: "Job 2416 update",
      cleanBody: "",
      jobs: [numbered, satConc, satSteel],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.selectedJobId).toBeNull();
  });

  it("distinguishingTitleEvidenceInRun rejects weak steel even when unique", () => {
    const peer: IdentityPeerJob = {
      jobId: "job-sat-steel",
      customerId: "cust-sat",
      contentTokens: ["sat", "structural", "steel"],
      distinguishingTokens: [],
      phraseTokenLists: [["sat", "structural", "steel"]],
      matchedContentTokens: ["sat", "steel"],
      kind: "OVERLAP",
    };
    const other: IdentityPeerJob = {
      jobId: "job-sat-stairs",
      customerId: "cust-sat",
      contentTokens: ["sat", "exterior", "stairs"],
      distinguishingTokens: [],
      phraseTokenLists: [["sat", "exterior", "stairs"]],
      matchedContentTokens: ["sat", "stairs"],
      kind: "OVERLAP",
    };
    expect(
      distinguishingTitleEvidenceInRun({
        run: ["sat", "steel"],
        peer,
        competitors: [peer, other],
        sharedIdentifiers: ["sat"],
      })
    ).toEqual([]);
    expect(
      distinguishingTitleEvidenceInRun({
        run: ["sat", "stairs"],
        peer: other,
        competitors: [peer, other],
        sharedIdentifiers: ["sat"],
      })
    ).toEqual(["stairs"]);
  });
});
