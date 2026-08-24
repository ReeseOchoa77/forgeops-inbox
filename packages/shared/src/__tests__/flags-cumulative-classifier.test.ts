import { describe, expect, it } from "vitest";

import {
  CUMULATIVE_BUSINESS_THRESHOLD,
  decideMailboxCategoryFlagsCumulative,
  senderCumulativeAdjustment,
} from "../reference/flags-cumulative-classifier.js";

describe("senderCumulativeAdjustment", () => {
  it("applies n8n sender adjustments", () => {
    expect(senderCumulativeAdjustment("LIKELY_BUSINESS")).toBe(25);
    expect(senderCumulativeAdjustment("LIKELY_PERSONAL")).toBe(-25);
    expect(senderCumulativeAdjustment("BLOCKED")).toBe(-25);
    expect(senderCumulativeAdjustment("UNKNOWN")).toBe(0);
    expect(senderCumulativeAdjustment("OBSERVED")).toBe(0);
    expect(senderCumulativeAdjustment("CONFIRMED_BUSINESS")).toBe(0);
    expect(senderCumulativeAdjustment("CONFIRMED_PERSONAL")).toBe(0);
  });
});

describe("decideMailboxCategoryFlagsCumulative", () => {
  it("1. CONFIRMED_BUSINESS → always BUSINESS", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.1,
      subjectBusinessProbability: 0.1,
      jobReferenceConfidence: 0.1,
      senderStatus: "CONFIRMED_BUSINESS",
    });
    expect(result.mailboxCategory).toBe("BUSINESS");
    expect(result.decisionRule).toBe("CONFIRMED_BUSINESS_SENDER");
    expect(result.requiresReview).toBe(false);
  });

  it("2. CONFIRMED_PERSONAL → PERSONAL", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.5,
      subjectBusinessProbability: 0.4,
      jobReferenceConfidence: 0.3,
      senderStatus: "CONFIRMED_PERSONAL",
    });
    expect(result.mailboxCategory).toBe("PERSONAL");
    expect(result.decisionRule).toBe("CONFIRMED_PERSONAL_SENDER");
  });

  it("3. all-three override of confirmed personal → BUSINESS + review", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.95,
      subjectBusinessProbability: 0.92,
      jobReferenceConfidence: 0.9,
      senderStatus: "CONFIRMED_PERSONAL",
    });
    expect(result.mailboxCategory).toBe("BUSINESS");
    expect(result.decisionRule).toBe(
      "ALL_THREE_BUSINESS_FLAGS_OVERRIDE_CONFIRMED_PERSONAL"
    );
    expect(result.requiresReview).toBe(true);
    expect(result.classificationDecision.flags?.allThreeBusiness).toBe(true);
  });

  it("4. single content flag >= 0.80 → BUSINESS", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.85,
      subjectBusinessProbability: 0.2,
      jobReferenceConfidence: 0.1,
      senderStatus: "UNKNOWN",
    });
    expect(result.mailboxCategory).toBe("BUSINESS");
    expect(result.decisionRule).toBe("STRONG_BUSINESS_FLAG");
    expect(result.classificationEvidence.content?.strongFlag).toBe(true);
  });

  it("5. single subject flag >= 0.80 → BUSINESS", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.1,
      subjectBusinessProbability: 0.9,
      jobReferenceConfidence: 0.1,
      senderStatus: "OBSERVED",
    });
    expect(result.decisionRule).toBe("STRONG_BUSINESS_FLAG");
    expect(result.classificationEvidence.subject?.strongFlag).toBe(true);
  });

  it("6. single job flag >= 0.80 → BUSINESS", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.1,
      subjectBusinessProbability: 0.1,
      jobReferenceConfidence: 0.88,
      senderStatus: "LIKELY_PERSONAL",
    });
    expect(result.decisionRule).toBe("STRONG_BUSINESS_FLAG");
    expect(result.classificationEvidence.job?.strongFlag).toBe(true);
  });

  it("7. cumulative score >= 150 → BUSINESS", () => {
    // 62 + 48 + 31 + 25 = 166
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.62,
      subjectBusinessProbability: 0.48,
      jobReferenceConfidence: 0.31,
      senderStatus: "LIKELY_BUSINESS",
    });
    expect(result.mailboxCategory).toBe("BUSINESS");
    expect(result.decisionRule).toBe("CUMULATIVE_BUSINESS_THRESHOLD");
    expect(result.classificationDecision.cumulative?.total).toBe(166);
    expect(result.classificationDecision.cumulative?.threshold).toBe(
      CUMULATIVE_BUSINESS_THRESHOLD
    );
  });

  it("8. cumulative score below 150 → PERSONAL", () => {
    // 40 + 40 + 32 + 0 = 112
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.4,
      subjectBusinessProbability: 0.4,
      jobReferenceConfidence: 0.32,
      senderStatus: "UNKNOWN",
    });
    expect(result.mailboxCategory).toBe("PERSONAL");
    expect(result.decisionRule).toBe("CUMULATIVE_PERSONAL");
    expect(result.classificationDecision.cumulative?.total).toBe(112);
  });

  it("9. likely-business sender +25 in cumulative path", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.5,
      subjectBusinessProbability: 0.5,
      jobReferenceConfidence: 0.5,
      senderStatus: "LIKELY_BUSINESS",
    });
    expect(result.classificationDecision.cumulative?.senderAdjustment).toBe(25);
    expect(result.classificationDecision.cumulative?.total).toBe(175);
    expect(result.mailboxCategory).toBe("BUSINESS");
  });

  it("10. likely-personal sender -25 in cumulative path", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.5,
      subjectBusinessProbability: 0.5,
      jobReferenceConfidence: 0.3,
      senderStatus: "LIKELY_PERSONAL",
    });
    expect(result.classificationDecision.cumulative?.senderAdjustment).toBe(-25);
    expect(result.classificationDecision.cumulative?.total).toBe(105);
    expect(result.mailboxCategory).toBe("PERSONAL");
  });

  it("11. signature is excluded from decision (includedInDecision=false)", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.1,
      subjectBusinessProbability: 0.1,
      jobReferenceConfidence: 0.1,
      signatureCompanyMatchConfidence: 0.99,
      senderStatus: "UNKNOWN",
    });
    expect(result.classificationEvidence.signature?.includedInDecision).toBe(
      false
    );
    expect(result.mailboxCategory).toBe("PERSONAL");
    expect(result.classificationDecision.cumulative?.total).toBe(30);
  });

  it("12. borderline strong flag at exactly 0.80", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.8,
      subjectBusinessProbability: 0,
      jobReferenceConfidence: 0,
      senderStatus: "UNKNOWN",
    });
    expect(result.decisionRule).toBe("STRONG_BUSINESS_FLAG");
    expect(result.classificationDecision.flags?.contentBusiness).toBe(true);
  });

  it("13. points are probability * 100 rounded", () => {
    const result = decideMailboxCategoryFlagsCumulative({
      contentBusinessProbability: 0.924,
      subjectBusinessProbability: 0.955,
      jobReferenceConfidence: 0.544,
      senderStatus: "UNKNOWN",
    });
    // strong flags fire first — still check points
    expect(result.classificationDecision.cumulative?.contentPoints).toBe(92);
    expect(result.classificationDecision.cumulative?.subjectPoints).toBe(96);
    expect(result.classificationDecision.cumulative?.jobPoints).toBe(54);
  });
});
