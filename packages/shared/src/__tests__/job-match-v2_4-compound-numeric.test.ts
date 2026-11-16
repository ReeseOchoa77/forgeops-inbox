/**
 * CONTEXT_AWARE_V2_4 — compound numeric identity (standalone digits ignored).
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
  JOB_MATCH_V2_4_IMPLEMENTATION_REVISION,
  JOB_MATCH_V2_4_PRIOR_FULL_BODY_ATTACHMENT_REVISION,
  JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION,
  JOB_MATCH_V2_4_LEGACY_IMPLEMENTATION_REVISION,
  experimentRevisionForIdentityPolicy,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import {
  extractCompoundNumericIdentities,
  extractCompoundNumericIdentitiesFromText,
  formatCompoundNumericKey,
} from "../jobs/job-contextual-compound-numeric.js";
import {
  extractContextualIdentityTerms,
  resolveContextualWordSearch,
} from "../jobs/job-contextual-word-search.js";
import { canonicalizeJobNameTokens } from "../jobs/job-name-normalize.js";
import { getProductionJobMatchIdentityPolicy } from "../jobs/job-match-policy-registry.js";
import { runJobAttachmentIdentityMarker } from "../jobs/job-attachment-identity.js";
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
    customerId: extras?.customerId ?? "cust-belt",
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

const beltB1 = job("job-belt-b1", "Beltline Bldg #1");
const beltB2 = job("job-belt-b2", "Beltline Bldg #2");
const beltB3 = job("job-belt-b3", "Beltline Bldg #3");
const beltRamp = job("job-belt-ramp", "Beltline Parking Ramp");
const beltPool = [beltB1, beltB2, beltB3, beltRamp];

const phase2 = job("job-phase-2", "Riverside Phase 2", {
  customerId: "cust-riv",
});
const phase3 = job("job-phase-3", "Riverside Phase 3", {
  customerId: "cust-riv",
});
const stair1 = job("job-stair-1", "North Stair 1", { customerId: "cust-n" });
const stair2 = job("job-stair-2", "North Stair 2", { customerId: "cust-n" });

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

describe("CONTEXT_AWARE_V2_4 compound numeric identity", () => {
  it("stamps V2_4_COMPOUND_NUMERIC_IDENTITY_R1 and preserves prior revisions", () => {
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
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2_4")).toBe(
      "V2_4_COMPOUND_NUMERIC_IDENTITY_R1"
    );
    expect(getProductionJobMatchIdentityPolicy()).toBe("CONTEXT_AWARE_V2");
  });

  it("normalizes Bldg #3 / Building 3 / Building # 3 / Bldg. 3 → building:3", () => {
    for (const text of [
      "Bldg #3",
      "Building 3",
      "Building # 3",
      "Bldg. 3",
    ]) {
      const compounds = extractCompoundNumericIdentitiesFromText(text);
      expect(compounds.map((c) => c.key)).toEqual(["building:3"]);
      expect(formatCompoundNumericKey("building", "3")).toBe("building:3");
    }
  });

  it("1–3. Beltline Bldg #1 / #2 / #3 resolve correctly", () => {
    for (const [subject, id] of [
      ["Beltline Bldg #1 shops", "job-belt-b1"],
      ["Beltline Bldg #2 shops", "job-belt-b2"],
      ["Beltline Bldg #3 shops", "job-belt-b3"],
    ] as const) {
      const r = runJobNameMarker({
        subject,
        cleanBody: "",
        jobs: beltPool,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      });
      expect(r.selectedJobId).toBe(id);
    }
  });

  it("4–5. Building 3 / Building # 3 equal Bldg #3", () => {
    for (const subject of [
      "Beltline Building 3 shops",
      "Beltline Building # 3 shops",
      "Beltline Bldg 3 shops",
    ]) {
      const r = runJobNameMarker({
        subject,
        cleanBody: "",
        jobs: beltPool,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      });
      expect(r.selectedJobId).toBe("job-belt-b3");
    }
  });

  it("6. Standalone 3 does not identify Building 3", () => {
    const r = runJobNameMarker({
      subject: "Beltline project update",
      cleanBody: "Three drawings attached for package 3.",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-belt-b3");
    expect(r.status).not.toBe("MATCH");
  });

  it("7. Three drawings does not identify Building 3", () => {
    const r = runJobNameMarker({
      subject: "Beltline project update. Three drawings attached.",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-belt-b3");
  });

  it("8. Building 1 does not match Building 2", () => {
    const r = runJobNameMarker({
      subject: "Beltline Building 1 shops",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBe("job-belt-b1");
    expect(r.selectedJobId).not.toBe("job-belt-b2");
  });

  it("9. Phase 2 does not match Phase 3", () => {
    const r = runJobNameMarker({
      subject: "Riverside Phase 2 drawings",
      cleanBody: "",
      jobs: [phase2, phase3],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBe("job-phase-2");
    expect(r.selectedJobId).not.toBe("job-phase-3");
  });

  it("10. Stair 1 does not match Stair 2", () => {
    const r = runJobNameMarker({
      subject: "North Stair 1 update",
      cleanBody: "",
      jobs: [stair1, stair2],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBe("job-stair-1");
    expect(r.selectedJobId).not.toBe("job-stair-2");
  });

  it("11–12. Unrelated numbers in subject/body are ignored", () => {
    const r = runJobNameMarker({
      subject: "Beltline — 4 attachments",
      cleanBody: "See sheet 12 and revision 3.",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBeNull();
    const diags = r.identityDiagnostics.compoundNumericDiagnostics ?? [];
    expect(
      diags.some((d) => d.code === "STANDALONE_NUMBER_IGNORED")
    ).toBe(true);
  });

  it("13. Attachment revision numbers are ignored", () => {
    const peers = beltPool.map(peerFromName);
    const marker = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "shop_rev_3.pdf",
          extractStatus: "READY",
          extractedText: "Revision 3 — general notes only.",
        },
      ],
      peers,
    });
    expect(marker.selectedJobId).not.toBe("job-belt-b3");
    expect(marker.status).toBe("NO_MATCH");
  });

  it("14. Title-block compound identifiers are recognized", () => {
    const peers = beltPool.map(peerFromName);
    const marker = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "title.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Beltline Building 2\nSheet 1 of 4",
        },
      ],
      peers,
    });
    expect(marker.selectedJobId).toBe("job-belt-b2");
  });

  it("15. Different building identifiers produce conflict when appropriate", () => {
    const r = runJobNameMarker({
      subject: "Beltline Bldg #1 and Bldg #2",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBeNull();
    expect([
      "NUMERIC_IDENTITY_CONFLICT",
      "CONTEXTUAL_WORD_SEARCH_AMBIGUOUS",
      "CONTEXTUAL_WORD_SEARCH_CONFLICT",
      "AMBIGUOUS_CANDIDATES",
    ]).toContain(r.identityDiagnostics.reason);
  });

  it("16. Quoted history does not override current identifiers", () => {
    const r = runJobNameMarker({
      subject: "Beltline Building 2 shops",
      cleanBody: [
        "Please review.",
        "",
        "On Mon, someone wrote:",
        "> Regarding Beltline Building 1 from last month",
      ].join("\n"),
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBe("job-belt-b2");
  });

  it("17. Internal Job numbers remain excluded", () => {
    const withNum = job("job-belt-num", "Beltline Bldg #3", {
      jobNumber: "99001",
    });
    const r = runJobNameMarker({
      subject: "Regarding 99001",
      cleanBody: "Please advise.",
      jobs: [withNum, beltB1],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-belt-num");
  });

  it("18–19. V2 / V2.1 / V2.2 / V2.3 remain distinct from V2.4 revision", () => {
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2")).toBeNull();
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2_1")).not.toBe(
      JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
    );
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2_2")).not.toBe(
      JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
    );
    expect(experimentRevisionForIdentityPolicy("CONTEXT_AWARE_V2_3")).not.toBe(
      JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
    );
    // Production policy unchanged.
    expect(getProductionJobMatchIdentityPolicy()).toBe(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2
    );
    // Spot-check V2.3 does not get V2.4 compound recovery stamp.
    const r23 = runJobNameMarker({
      subject: "Beltline project update, 2 attachments",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(r23.identityDiagnostics.identityPolicy).toBe(
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3
    );
  });

  it("20. Historical V2.4 revision labels remain preserved as constants", () => {
    expect(JOB_MATCH_V2_4_PRIOR_FULL_BODY_ATTACHMENT_REVISION).not.toBe(
      JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
    );
    expect(JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION).not.toBe(
      JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
    );
  });

  it("standalone numeric terms are not identity terms for peers", () => {
    const peer = peerFromName(beltB3);
    const terms = extractContextualIdentityTerms(peer);
    expect(terms).not.toContain("3");
    expect(terms).toContain("building:3");
    expect(terms).toContain("beltline");
  });

  it("Beltline Building 2 shop drawings resolves Bldg #2", () => {
    const r = runJobNameMarker({
      subject: "Beltline Building 2 shop drawings",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).toBe("job-belt-b2");
  });

  it("Beltline project update, 2 attachments does not select Building 2", () => {
    const r = runJobNameMarker({
      subject: "Beltline project update, 2 attachments",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-belt-b2");
  });

  it("Building 2 alone does not auto-select Beltline Building 2 across family", () => {
    const r = runJobNameMarker({
      subject: "Building 2 drawings",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    // Without Beltline family established, compound alone must not force Beltline B2
    // unless independently unambiguous under conservative full-body rules.
    if (r.selectedJobId === "job-belt-b2") {
      expect(r.identityDiagnostics.reason).not.toBe(
        "CONTEXTUAL_WORD_SEARCH_MATCH"
      );
    } else {
      expect(r.selectedJobId).toBeNull();
    }
  });

  it("email Building 2 vs candidate Building 1 is contradictory", () => {
    const peers = [beltB1, beltB2, beltRamp].map(peerFromName);
    const resolved = resolveContextualWordSearch({
      peers,
      subjectTokens: canonicalizeJobNameTokens("Beltline Bldg #2"),
      bodyTokens: [],
    });
    expect(resolved.selectedJobId).toBe("job-belt-b2");
    expect(
      (resolved.compoundNumericDiagnostics ?? []).some(
        (d) => d.code === "NUMERIC_IDENTITY_CONFLICT"
      )
    ).toBe(true);
  });

  it("descriptor+number adjacency is required", () => {
    const tokens = canonicalizeJobNameTokens(
      "Beltline Building drawings. Three revisions attached."
    );
    const compounds = extractCompoundNumericIdentities(tokens);
    expect(compounds.find((c) => c.key === "building:3")).toBeUndefined();
  });
});
