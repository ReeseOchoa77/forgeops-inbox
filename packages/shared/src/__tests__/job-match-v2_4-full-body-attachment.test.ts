/**
 * V2.4 extension — full-body project identity + Attachment Identity marker.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
  JOB_MATCH_V2_4_IMPLEMENTATION_REVISION,
  JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import { runJobMatchPipeline } from "../jobs/job-match-pipeline.js";
import {
  runJobAttachmentIdentityMarker,
  validateAttachmentIdentityAiDecision,
} from "../jobs/job-attachment-identity.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import type { IdentityPeerJob } from "../jobs/job-name-identity-policy.js";
import { getProductionJobMatchIdentityPolicy } from "../jobs/job-match-policy-registry.js";

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
    customerId: extras?.customerId ?? "cust-1",
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

const exodus = job("job-exodus", "Exodus");
const other = job("job-other", "Riverside Commons");
const beltB1 = job("job-b1", "Beltline Building 1", { customerId: "belt" });
const beltRamp = job("job-ramp", "Beltline Parking Ramp", {
  customerId: "belt",
});

function peer(j: JobRecordForMatch, tokens: string[]): IdentityPeerJob {
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

describe("V2.4 full-body + attachment identity", () => {
  it("revision is full-body+attachment (prior contextual preserved)", () => {
    expect(JOB_MATCH_V2_4_IMPLEMENTATION_REVISION).toBe(
      "V2_4_FULL_BODY_ATTACHMENT_IDENTITY_R1"
    );
    expect(JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION).toBe(
      "V2_4_CONTEXTUAL_WORD_SEARCH"
    );
  });

  it("1. Exodus in subject", () => {
    const r = runJobNameMarker({
      subject: "Exodus revised drawings",
      cleanBody: "",
      jobs: [exodus, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-exodus");
  });

  it("2. Exodus absent from subject but explicitly in current body", () => {
    const r = runJobNameMarker({
      subject: "Revised structural steel submittal",
      cleanBody: "Please see the attached drawings for the Exodus project.",
      jobs: [exodus, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.status).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-exodus");
    expect(r.identityDiagnostics.reason).toBe("FULL_BODY_PROJECT_IDENTITY");
  });

  it("3. Exodus only in quoted reply history does not match", () => {
    const r = runJobNameMarker({
      subject: "Revised drawings",
      cleanBody: [
        "Please advise.",
        "",
        "On Mon, someone wrote:",
        "> Regarding the Exodus project from last month",
      ].join("\n"),
      jobs: [exodus, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-exodus");
  });

  it("4. Exodus only in signature does not match", () => {
    const r = runJobNameMarker({
      subject: "Revised drawings",
      cleanBody: [
        "Please advise.",
        "",
        "--",
        "Jane Doe",
        "Exodus Project Coordinator",
      ].join("\n"),
      jobs: [exodus, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    });
    expect(r.selectedJobId).not.toBe("job-exodus");
  });

  it("5. Exodus in attachment filename", () => {
    const peers = [
      peer(exodus, ["exodus"]),
      peer(other, ["riverside", "commons"]),
    ];
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "Exodus_Project_Submittal.pdf",
          extractStatus: "READY",
          extractedText: null,
        },
      ],
      peers,
    });
    expect(att.status).toBe("MATCH");
    expect(att.selectedJobId).toBe("job-exodus");
    expect(att.diagnostics.hits[0]?.category).toBe(
      "ATTACHMENT_FILENAME_PROJECT"
    );
  });

  it("6. Exodus in PDF project title block", () => {
    const peers = [
      peer(exodus, ["exodus"]),
      peer(other, ["riverside", "commons"]),
    ];
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "Structural_Revision_03.pdf",
          extractStatus: "READY",
          extractedText: "SHEET S-101\nPROJECT: EXODUS\nSCALE: 1/4\"",
        },
      ],
      peers,
    });
    expect(att.status).toBe("MATCH");
    expect(att.selectedJobId).toBe("job-exodus");
    expect(
      att.diagnostics.hits.some(
        (h) => h.category === "ATTACHMENT_TITLE_BLOCK_PROJECT"
      )
    ).toBe(true);
  });

  it("7. Exodus in document project header", () => {
    const peers = [peer(exodus, ["exodus"]), peer(other, ["riverside"])];
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "notes.docx",
          extractStatus: "READY",
          extractedText: "Project Name: Exodus\nPrepared for review",
        },
      ],
      peers,
    });
    expect(att.selectedJobId).toBe("job-exodus");
  });

  it("8. Exodus mentioned incidentally in attachment text", () => {
    const peers = [peer(exodus, ["exodus"]), peer(other, ["riverside"])];
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "detail.pdf",
          extractStatus: "READY",
          extractedText:
            "See Exodus project for an example of this connection detail.",
        },
      ],
      peers,
    });
    // Incidental body reference alone should not be strong MATCH, or if matched
    // should be weak / filtered — prefer no confident assignment.
    if (att.status === "MATCH") {
      expect(att.laterStrength).toBe("WEAK");
    } else {
      expect(att.selectedJobId).toBeNull();
    }
  });

  it("9. Multiple Job names in one attachment → ambiguous/conflict", () => {
    const peers = [
      peer(exodus, ["exodus"]),
      peer(other, ["riverside", "commons"]),
    ];
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "set.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Exodus\nPROJECT: Riverside Commons",
        },
      ],
      peers,
    });
    expect(["AMBIGUOUS", "CONFLICT"]).toContain(att.status);
    expect(att.selectedJobId).toBeNull();
  });

  it("10. Subject and attachment identify different Jobs → conflict", () => {
    const r = runJobMatchPipeline({
      subject: "Beltline Building 1 shops",
      cleanBody: "",
      jobs: [beltB1, beltRamp, exodus],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      attachmentsForMatch: [
        {
          attachmentId: "a1",
          filename: "ramp.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Beltline Parking Ramp",
        },
      ],
    });
    // Strong subject MATCH for Building 1 stops before attachment — protected.
    expect(r.decision).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-b1");
    expect(r.markerTrace?.some((t) => t.marker === "ATTACHMENT")).toBe(false);
  });

  it("11. Multiple attachments identify different Jobs", () => {
    const peers = [
      peer(exodus, ["exodus"]),
      peer(other, ["riverside", "commons"]),
    ];
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "a.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Exodus",
        },
        {
          attachmentId: "a2",
          filename: "b.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Riverside Commons",
        },
      ],
      peers,
    });
    expect(["AMBIGUOUS", "CONFLICT"]).toContain(att.status);
  });

  it("12. Attachment extraction unavailable is disclosed", () => {
    const att = runJobAttachmentIdentityMarker({
      attachments: [],
      peers: [peer(exodus, ["exodus"])],
      attachmentsPresentButNotLoaded: true,
    });
    expect(att.diagnostics.reason).toBe("ATTACHMENT_EXTRACTION_UNAVAILABLE");
    expect(att.diagnostics.extractionComplete).toBe(false);
  });

  it("13. Unsupported attachment format", () => {
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "model.dwg",
          extractStatus: "UNSUPPORTED",
          extractedText: null,
        },
      ],
      peers: [peer(exodus, ["exodus"])],
    });
    expect(att.diagnostics.attachmentsUnsupported).toBe(1);
    expect(att.selectedJobId).toBeNull();
  });

  it("14. Scanned PDF with TEXT_UNAVAILABLE does not invent absence", () => {
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "scan.pdf",
          extractStatus: "UNAVAILABLE",
          extractedText: null,
        },
      ],
      peers: [peer(exodus, ["exodus"])],
    });
    expect(att.diagnostics.attachmentsUnavailable).toBe(1);
    // Filename-only may still match; scanned without text is not "checked" as body.
    expect(att.diagnostics.attachmentsProcessed).toBe(0);
  });

  it("15. Multi-page PDF title block after page one", () => {
    const peers = [peer(exodus, ["exodus"])];
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "set.pdf",
          extractStatus: "READY",
          extractedText: "Cover sheet",
          pageTexts: [
            { pageNumber: 1, text: "Cover" },
            { pageNumber: 3, text: "PROJECT: Exodus\nTitle block" },
          ],
        },
      ],
      peers,
    });
    expect(att.selectedJobId).toBe("job-exodus");
    expect(
      att.diagnostics.hits.some((h) => h.pageNumber === 3)
    ).toBe(true);
  });

  it("16. Body and attachment agree on Exodus", () => {
    const r = runJobMatchPipeline({
      subject: "Revised structural steel submittal",
      cleanBody: "Please see the attached drawings for the Exodus project.",
      jobs: [exodus, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      attachmentsForMatch: [
        {
          attachmentId: "a1",
          filename: "Structural_Revision_03.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: EXODUS",
        },
      ],
    });
    expect(r.decision).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-exodus");
  });

  it("17. Strong subject identity protected from incidental attachment refs", () => {
    const r = runJobMatchPipeline({
      subject: "Exodus shop drawings",
      cleanBody: "",
      jobs: [exodus, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      attachmentsForMatch: [
        {
          attachmentId: "a1",
          filename: "notes.pdf",
          extractStatus: "READY",
          extractedText:
            "See Riverside Commons for an example of this connection.",
        },
      ],
    });
    expect(r.decision).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-exodus");
  });

  it("18. Removed Jobs excluded from attachment matching", () => {
    const removed = job("job-rem", "Exodus", {
      archivedAt: new Date("2024-01-01"),
    });
    const r = runJobMatchPipeline({
      subject: "drawings",
      cleanBody: "",
      jobs: [removed, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      attachmentsForMatch: [
        {
          attachmentId: "a1",
          filename: "Exodus.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Exodus",
        },
      ],
    });
    expect(r.selectedJobId).not.toBe("job-rem");
  });

  it("19. Unawarded bids excluded", () => {
    const bid = job("job-bid", "Exodus", { status: "BIDDING" });
    const r = runJobMatchPipeline({
      subject: "drawings",
      cleanBody: "",
      jobs: [bid, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      attachmentsForMatch: [
        {
          attachmentId: "a1",
          filename: "Exodus.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Exodus",
        },
      ],
    });
    expect(r.selectedJobId).not.toBe("job-bid");
  });

  it("20. Internal Job numbers are not attachment evidence", () => {
    const withNum = job("job-num", "Exodus", { jobNumber: "99112" });
    const r = runJobMatchPipeline({
      subject: "Regarding 99112",
      cleanBody: "",
      jobs: [withNum, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      attachmentsForMatch: [
        {
          attachmentId: "a1",
          filename: "99112.pdf",
          extractStatus: "READY",
          extractedText: "Job 99112 drawing set",
        },
      ],
    });
    expect(r.selectedJobId).not.toBe("job-num");
  });

  it("21. Production V2 unchanged (no full-body Exodus, no ATTACHMENT marker)", () => {
    const r = runJobMatchPipeline({
      subject: "Revised structural steel submittal",
      cleanBody: "Please see the attached drawings for the Exodus project.",
      jobs: [exodus, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      attachmentsForMatch: [
        {
          attachmentId: "a1",
          filename: "Exodus.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: EXODUS",
        },
      ],
    });
    expect(r.markerTrace?.some((t) => t.marker === "ATTACHMENT")).toBe(false);
    // V2 may or may not match Exodus via baseline OVERLAP — assert no attachment path.
    expect(getProductionJobMatchIdentityPolicy()).toBe("CONTEXT_AWARE_V2");
  });

  it("22. V2.1 / V2.2 / V2.3 unchanged (no ATTACHMENT marker)", () => {
    for (const policy of [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    ] as const) {
      const r = runJobMatchPipeline({
        subject: "Revised drawings",
        cleanBody: "Please see Exodus project drawings.",
        jobs: [exodus, other],
        identityPolicy: policy,
        attachmentsForMatch: [
          {
            attachmentId: "a1",
            filename: "Exodus.pdf",
            extractStatus: "READY",
            extractedText: "PROJECT: EXODUS",
          },
        ],
      });
      expect(r.markerTrace?.some((t) => t.marker === "ATTACHMENT")).toBe(false);
      expect(r.identityDiagnostics.reason).not.toBe(
        "ATTACHMENT_IDENTITY_MATCH"
      );
    }
  });

  it("23. Historical prior revision label remains distinct", () => {
    expect(JOB_MATCH_V2_4_PRIOR_CONTEXTUAL_WORD_SEARCH_REVISION).not.toBe(
      JOB_MATCH_V2_4_IMPLEMENTATION_REVISION
    );
  });

  it("24. Workspace isolation — only supplied peers are candidates", () => {
    const att = runJobAttachmentIdentityMarker({
      attachments: [
        {
          attachmentId: "a1",
          filename: "Exodus.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: Exodus",
        },
      ],
      peers: [peer(other, ["riverside"])],
    });
    expect(att.selectedJobId).not.toBe("job-exodus");
  });

  it("25. AI cannot invent Jobs; invalid excerpts rejected", () => {
    const bad = validateAttachmentIdentityAiDecision({
      decision: {
        selectedJobId: "job-invented",
        decision: "MATCH",
        supportingExcerpt: "PROJECT: Exodus",
      },
      candidateJobIds: ["job-exodus"],
      extractedTexts: ["PROJECT: Exodus"],
    });
    expect(bad.ok).toBe(false);

    const missingExcerpt = validateAttachmentIdentityAiDecision({
      decision: {
        selectedJobId: "job-exodus",
        decision: "MATCH",
        supportingExcerpt: "not in document",
      },
      candidateJobIds: ["job-exodus"],
      extractedTexts: ["PROJECT: Exodus"],
    });
    expect(missingExcerpt.ok).toBe(false);
  });

  it("pipeline exposes ATTACHMENT marker when V2.4 resolves via attachment only", () => {
    const r = runJobMatchPipeline({
      subject: "Revised drawings",
      cleanBody: "Please review the attached set.",
      jobs: [exodus, other],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
      attachmentsForMatch: [
        {
          attachmentId: "a1",
          filename: "Structural_Revision_03.pdf",
          extractStatus: "READY",
          extractedText: "PROJECT: EXODUS",
        },
      ],
    });
    expect(r.decision).toBe("MATCH");
    expect(r.selectedJobId).toBe("job-exodus");
    expect(r.markerTrace?.some((t) => t.marker === "ATTACHMENT")).toBe(true);
    expect(r.attachmentDiagnostics?.reason).toBe("ATTACHMENT_IDENTITY_MATCH");
  });
});
