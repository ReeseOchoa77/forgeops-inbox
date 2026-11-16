/**
 * CONTEXT_AWARE_V3 — dynamic word importance + family-scoped numeric.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
  JOB_MATCH_V3_IMPLEMENTATION_REVISION,
  JOB_MATCH_V2_4_IMPLEMENTATION_REVISION,
  JOB_MATCH_V2_4_PRIOR_FULL_BODY_ATTACHMENT_REVISION,
  JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION,
  JOB_MATCH_V2_4_LEGACY_IMPLEMENTATION_REVISION,
  experimentRevisionForIdentityPolicy,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import { getProductionJobMatchIdentityPolicy } from "../jobs/job-match-policy-registry.js";
import { runJobAttachmentIdentityMarker } from "../jobs/job-attachment-identity.js";
import { canonicalizeJobNameTokens } from "../jobs/job-name-normalize.js";
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

const nova = job("job-nova", "Nova Classical");
const other = job("job-other", "Riverside Parking", { customerId: "cust-b" });

const beltB1 = job("job-belt-b1", "Beltline Bldg #1", {
  customerId: "cust-belt",
});
const beltB2 = job("job-belt-b2", "Beltline Bldg #2", {
  customerId: "cust-belt",
});
const beltB3 = job("job-belt-b3", "Beltline Bldg #3", {
  customerId: "cust-belt",
});
const beltRamp = job("job-belt-ramp", "Beltline Parking Ramp", {
  customerId: "cust-belt",
});
const beltPool = [beltB1, beltB2, beltB3, beltRamp];

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

describe("CONTEXT_AWARE_V3 dynamic word importance + family numeric", () => {
  it("stamps V3_DYNAMIC_WORD_IMPORTANCE_R1 and preserves prior revisions", () => {
    expect(JOB_MATCH_V3_IMPLEMENTATION_REVISION).toBe(
      "V3_DYNAMIC_WORD_IMPORTANCE_R1"
    );
    expect(JOB_MATCH_V2_4_IMPLEMENTATION_REVISION).toBe(
      "V2_4_COMPOUND_NUMERIC_IDENTITY_R1"
    );
    expect(JOB_MATCH_V2_4_PRIOR_FULL_BODY_ATTACHMENT_REVISION).toBe(
      "V2_4_FULL_BODY_ATTACHMENT_IDENTITY_R1"
    );
    expect(JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION).toBe(
      "V2_4_CONTEXTUAL_WORD_SEARCH"
    );
    expect(JOB_MATCH_V2_4_LEGACY_IMPLEMENTATION_REVISION).toBe("V2_4_LEGACY");
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V3")).toBe(
      "V3_DYNAMIC_WORD_IMPORTANCE_R1"
    );
    expect(getProductionJobMatchIdentityPolicy()).toBe(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
  });

  it('1. "Nova" → Nova Classical', () => {
    const r = runJobNameMarker({
      subject: "Nova shop drawing revisions",
      cleanBody: "",
      jobs: [nova, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBe("job-nova");
    expect(r.identityDiagnostics.reason).toBe("SINGLE_WORD_PROJECT_IDENTITY");
  });

  it('2. "Nova project" → Nova Classical', () => {
    const r = runJobNameMarker({
      subject: "Hourly summary",
      cleanBody: "These drawings are for the Nova project.",
      jobs: [nova, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBe("job-nova");
  });

  it("3. Nova mentioned incidentally does not automatically assign", () => {
    const r = runJobNameMarker({
      subject: "Coordination notes",
      cleanBody:
        "Nova was mentioned as an example from another project. Please review Riverside Parking shops.",
      jobs: [nova, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).not.toBe("job-nova");
  });

  it('4–6. Beltline #1 / #2 / #3 resolve correct buildings', () => {
    for (const [subject, id] of [
      ["Beltline #1 shops", "job-belt-b1"],
      ["Beltline #2 shops", "job-belt-b2"],
      ["Beltline #3 shops", "job-belt-b3"],
    ] as const) {
      const r = runJobNameMarker({
        subject,
        cleanBody: "",
        jobs: beltPool,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
      });
      expect(r.selectedJobId).toBe(id);
    }
  });

  it('7–8. Beltline Bldg #3 / Building 3 still resolve', () => {
    for (const subject of [
      "Beltline Bldg #3 shops",
      "Beltline Building 3 shops",
    ]) {
      const r = runJobNameMarker({
        subject,
        cleanBody: "",
        jobs: beltPool,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
      });
      expect(r.selectedJobId).toBe("job-belt-b3");
    }
  });

  it('9. "Beltline 3" resolves with adjacent family+number context', () => {
    const r = runJobNameMarker({
      subject: "Beltline 3 shops",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBe("job-belt-b3");
  });

  it('10. "Beltline" alone remains ambiguous', () => {
    const r = runJobNameMarker({
      subject: "Beltline project update",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBeNull();
    expect(r.status).toBe("AMBIGUOUS");
  });

  it('11. "Bldg" alone cannot resolve', () => {
    const r = runJobNameMarker({
      subject: "Bldg shop drawings",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBeNull();
  });

  it('12–13. "3 drawings" / "3 open RFIs" cannot identify Building 3', () => {
    const r1 = runJobNameMarker({
      subject: "Beltline project update",
      cleanBody: "We attached 3 drawings.",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r1.selectedJobId).not.toBe("job-belt-b3");

    const r2 = runJobNameMarker({
      subject: "Beltline status",
      cleanBody: "Beltline has 3 open RFIs.",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r2.selectedJobId).not.toBe("job-belt-b3");
  });

  it("14. Building 2 does not match Building 1", () => {
    const r = runJobNameMarker({
      subject: "Beltline #2 shops",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBe("job-belt-b2");
    expect(r.selectedJobId).not.toBe("job-belt-b1");
  });

  it("15. SAT alone remains ambiguous", () => {
    const r = runJobNameMarker({
      subject: "SAT shop drawing revisions",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.selectedJobId).toBeNull();
  });

  it("16. SAT + concessions resolves Concessions", () => {
    const r = runJobNameMarker({
      subject: "SAT concessions update",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBe("job-sat-conc");
  });

  it("17. Generic construction terms cannot independently resolve", () => {
    const r = runJobNameMarker({
      subject: "Structural steel shop drawings",
      cleanBody: "",
      jobs: satPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBeNull();
  });

  it("18. Explicit body project identity with generic subject", () => {
    const r = runJobNameMarker({
      subject: "Hourly summary: 1 item requiring your attention",
      cleanBody: "Frana Companies, Inc • Beltline – Bldg #2",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBe("job-belt-b2");
  });

  it("19. HTML-ish notification project headers are recognized", () => {
    const r = runJobNameMarker({
      subject: "Notification",
      cleanBody: [
        "Project: Beltline Bldg #1",
        "Please review the package.",
      ].join("\n"),
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBe("job-belt-b1");
  });

  it("20. Attachment title-block project identity remains functional", () => {
    const marker = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "title.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Beltline Building 2\nSheet 1",
        },
      ],
      peers: beltPool.map(peerFromName),
      features: {
        enableUniqueProjectTerms: true,
        enableFamilyScopedNumeric: true,
      },
    });
    expect(marker.selectedJobId).toBe("job-belt-b2");
  });

  it("21. Quoted history does not override current identity", () => {
    const r = runJobNameMarker({
      subject: "Beltline #2 shops",
      cleanBody: [
        "Please review.",
        "",
        "On Mon, someone wrote:",
        "> Regarding Beltline #1 from last month",
      ].join("\n"),
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).toBe("job-belt-b2");
  });

  it("22. Removed Jobs remain excluded", () => {
    const removed = job("job-nova-removed", "Nova Classical", {
      archivedAt: new Date("2024-01-01"),
    });
    const r = runJobNameMarker({
      subject: "Nova update",
      cleanBody: "",
      jobs: [nova, removed],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).not.toBe("job-nova-removed");
  });

  it("23. Unawarded active bids remain excluded", () => {
    const bidding = job("job-nova-bid", "Nova Classical", {
      status: "BIDDING",
    });
    const r = runJobNameMarker({
      subject: "Nova update",
      cleanBody: "",
      jobs: [nova, bidding],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).not.toBe("job-nova-bid");
  });

  it("24. Internal TEK STEEL Job numbers are not matching evidence", () => {
    const withNum = job("job-nova-num", "Nova Classical", {
      jobNumber: "77441",
    });
    const r = runJobNameMarker({
      subject: "Regarding 77441",
      cleanBody: "Please advise.",
      jobs: [withNum, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    });
    expect(r.selectedJobId).not.toBe("job-nova-num");
  });

  it("25–26. V2 / V2.1–V2.3 remain unchanged (policy + revision)", () => {
    expect(getProductionJobMatchIdentityPolicy()).toBe(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2")).toBeNull();
    for (const p of [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    ] as const) {
      expect(experimentRevisionForIdentityPolicy(p)).not.toBe(
        JOB_MATCH_V3_IMPLEMENTATION_REVISION
      );
    }
  });

  it("27. Historical V2.4 revision labels remain accessible", () => {
    expect(JOB_MATCH_V2_4_IMPLEMENTATION_REVISION).not.toBe(
      JOB_MATCH_V3_IMPLEMENTATION_REVISION
    );
    expect(JOB_MATCH_V2_4_PRIOR_FULL_BODY_ATTACHMENT_REVISION).not.toBe(
      JOB_MATCH_V3_IMPLEMENTATION_REVISION
    );
    expect(JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION).not.toBe(
      JOB_MATCH_V3_IMPLEMENTATION_REVISION
    );
  });
});
