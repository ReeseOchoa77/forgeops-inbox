/**
 * V2.1 shared-id body disambiguation: subject establishes project family;
 * current message body may supply unique distinguishing Job terms.
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
  distinguishingTermsForPeer,
  isTokenNegatedInHay,
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

describe("V2.1 shared-identifier subject + body disambiguation", () => {
  it("SAT subject + concessions in body → SAT Concessions", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please review the revised concessions drawings.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
    expect(v21.identityDiagnostics.reason).toBe("UNIQUE_BODY_DISAMBIGUATION");
    expect(v21.identityDiagnostics.evidenceField).toBe("body");
    expect(v21.identityDiagnostics.sharedIdentityTerms).toContain("sat");
    expect(v21.identityDiagnostics.distinguishingIdentityTerms).toContain(
      "concessions"
    );
  });

  it("SAT subject + stairs in body → SAT Exterior Stairs", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please review the revised stairs drawings.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-stairs");
    expect(v21.identityDiagnostics.reason).toBe("UNIQUE_BODY_DISAMBIGUATION");
    expect(v21.identityDiagnostics.evidenceField).toBe("body");
  });

  it("SAT subject + no distinguishing body evidence → Ambiguous", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please see the attached revised drawings.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("AMBIGUOUS");
    expect(v21.selectedJobId).toBeNull();
    expect(v21.identityDiagnostics.reason).toBe("INSUFFICIENT_DISAMBIGUATION");
  });

  it("SAT subject + generic body vocabulary → Ambiguous", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Steel fabrication status update for the project delivery.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("AMBIGUOUS");
    expect(v21.selectedJobId).toBeNull();
  });

  it("SAT subject + multiple competing body terms → Ambiguous", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please review the stairs and concessions changes.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("AMBIGUOUS");
    expect(v21.selectedJobId).toBeNull();
    expect([
      "COMPETING_TITLE_EVIDENCE",
      "CONTRADICTORY_PROJECT_EVIDENCE",
    ]).toContain(v21.identityDiagnostics.reason);
  });

  it("SAT subject + distinguishing term only in quoted reply → Ambiguous", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: [
        "Please see the attached revised drawings.",
        "",
        "On Mon, someone wrote:",
        "> Please review the revised concessions drawings.",
      ].join("\n"),
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("AMBIGUOUS");
    expect(v21.selectedJobId).toBeNull();
    expect(v21.identityDiagnostics.reason).toBe("INSUFFICIENT_DISAMBIGUATION");
  });

  it("SAT subject + negated distinguishing term → not positive; stairs wins", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody:
        "These drawings are not for concessions. They are for the exterior stairs.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-stairs");
    expect([
      "UNIQUE_BODY_DISAMBIGUATION",
      "DISTINGUISHING_TITLE_EVIDENCE",
    ]).toContain(v21.identityDiagnostics.reason);
    expect(v21.identityDiagnostics.distinguishingIdentityTerms).not.toContain(
      "concessions"
    );
  });

  it("whole-token matching rejects substrings", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please review the preconcessions staging area drawings.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.selectedJobId).toBeNull();
    expect(v21.status).toBe("AMBIGUOUS");
  });

  it("case-insensitive body matching", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please review the revised CONCESSIONS drawings.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
    expect(v21.identityDiagnostics.reason).toBe("UNIQUE_BODY_DISAMBIGUATION");
  });

  it("removed Jobs excluded from competition", () => {
    const removedStairs = job("job-sat-stairs-gone", "SAT - Exterior Stairs", {
      customerId: "cust-sat",
      archivedAt: new Date("2024-01-01"),
    });
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please review the revised concessions drawings.",
      jobs: [satConc, satSteel, removedStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
  });

  it("unawarded / ineligible bid Jobs excluded from competition", () => {
    const bidStairs = job("job-sat-bid", "SAT - Exterior Stairs", {
      customerId: "cust-sat",
      status: "BIDDING",
    });
    const v21 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please review the revised concessions drawings.",
      jobs: [satConc, satSteel, bidStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
  });

  it("production V2 remains unchanged on body-disambiguation cases", () => {
    const v2 = runJobNameMarker({
      subject: "SAT - Updated Drawings",
      cleanBody: "Please review the revised concessions drawings.",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.status).toBe("AMBIGUOUS");
    expect(v2.selectedJobId).toBeNull();
  });

  it("V2.2 unique-token behavior remains unchanged", () => {
    const v22 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "Please review the revised concessions drawings.",
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
      subject: "SAT - Updated Drawings",
      cleanBody: "Please update Job 2416 when ready.",
      jobs: [numbered, satConc, satSteel],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.selectedJobId).toBeNull();
    expect(v21.status).toBe("AMBIGUOUS");
  });

  it("isTokenNegatedInHay detects short-window negation", () => {
    const hay = ["these", "are", "not", "for", "concessions"];
    expect(isTokenNegatedInHay(hay, 4)).toBe(true);
    expect(isTokenNegatedInHay(["review", "concessions", "drawings"], 1)).toBe(
      false
    );
  });

  it("distinguishingTermsForPeer skips shared id and weak steel", () => {
    const peer: IdentityPeerJob = {
      jobId: "job-sat-steel",
      customerId: "cust-sat",
      contentTokens: ["sat", "structural", "steel"],
      distinguishingTokens: [],
      phraseTokenLists: [["sat", "structural", "steel"]],
      matchedContentTokens: ["sat"],
      kind: "OVERLAP",
    };
    const other: IdentityPeerJob = {
      jobId: "job-sat-stairs",
      customerId: "cust-sat",
      contentTokens: ["sat", "exterior", "stairs"],
      distinguishingTokens: [],
      phraseTokenLists: [["sat", "exterior", "stairs"]],
      matchedContentTokens: ["sat"],
      kind: "OVERLAP",
    };
    expect(
      distinguishingTermsForPeer({
        peer,
        competitors: [peer, other],
        sharedIdentifiers: ["sat"],
      })
    ).toEqual([]);
    expect(
      distinguishingTermsForPeer({
        peer: other,
        competitors: [peer, other],
        sharedIdentifiers: ["sat"],
      }).sort()
    ).toEqual(["exterior", "stairs"]);
  });
});
