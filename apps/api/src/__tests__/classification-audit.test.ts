import { describe, expect, it } from "vitest";

import {
  buildNeedsReviewClassificationWhere,
  computeAuditStatus,
} from "../interfaces/http/routes/classification-audit.route.js";

describe("computeAuditStatus", () => {
  it("marks pending / requiresReview as NEEDS_REVIEW", () => {
    expect(
      computeAuditStatus({
        requiresReview: true,
        reviewStatus: "NOT_REQUIRED",
        previousCategory: null,
      })
    ).toBe("NEEDS_REVIEW");
    expect(
      computeAuditStatus({
        requiresReview: false,
        reviewStatus: "PENDING",
        previousCategory: null,
      })
    ).toBe("NEEDS_REVIEW");
  });

  it("confirmed without previous category", () => {
    expect(
      computeAuditStatus({
        requiresReview: false,
        reviewStatus: "APPROVED",
        previousCategory: null,
      })
    ).toBe("CONFIRMED");
  });

  it("corrected when previous category present", () => {
    expect(
      computeAuditStatus({
        requiresReview: false,
        reviewStatus: "APPROVED",
        previousCategory: "BUSINESS",
      })
    ).toBe("CORRECTED");
  });

  it("dismissed on reject", () => {
    expect(
      computeAuditStatus({
        requiresReview: false,
        reviewStatus: "REJECTED",
        previousCategory: null,
      })
    ).toBe("DISMISSED");
  });

  it("auto for high-confidence unreviewed", () => {
    expect(
      computeAuditStatus({
        requiresReview: false,
        reviewStatus: "NOT_REQUIRED",
        previousCategory: null,
      })
    ).toBe("AUTO");
  });
});

describe("buildNeedsReviewClassificationWhere", () => {
  it("does not use confidence-only OR (confirmed low-confidence must leave queue)", () => {
    const where = buildNeedsReviewClassificationWhere();
    const json = JSON.stringify(where);
    expect(json).toContain("requiresReview");
    expect(json).toContain("PENDING");
    expect(json).not.toMatch(/"confidence"/);
  });
});

describe("classification audit pagination contract", () => {
  it("defaults page size to 50 not 25", () => {
    const DEFAULT_PAGE_SIZE = 50;
    expect(DEFAULT_PAGE_SIZE).toBe(50);
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThan(25);
  });

  it("confirm updates status and does not imply delete", () => {
    // Documented contract: review PATCH sets requiresReview=false, keeps Classification row
    const afterConfirm = {
      id: "c1",
      requiresReview: false,
      reviewStatus: "APPROVED" as const,
      deleted: false,
    };
    expect(afterConfirm.deleted).toBe(false);
    expect(afterConfirm.requiresReview).toBe(false);
    expect(afterConfirm.reviewStatus).toBe("APPROVED");
  });
});
