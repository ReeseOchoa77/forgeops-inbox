import { describe, expect, it } from "vitest";
import {
  BID_INVITE_LOOKBACK_DAYS,
  normalizeBiddingProjectName,
  resolveBidInviteSearchSinceAt,
  scoreEmailToQuoteProject,
  scoreProjectNameSimilarity,
} from "../bidding/project-name-similarity.js";
import { buildQuoteProjectGroupKey } from "../bidding/bid-candidate-identity.js";

describe("normalizeBiddingProjectName", () => {
  it("strips ITB / Quote wrappers so invite and quote subjects align", () => {
    const a = normalizeBiddingProjectName("ITB - North Memorial Expansion");
    const b = normalizeBiddingProjectName(
      "North Memorial Expansion - Structural Steel Quote"
    );
    expect(a).toBe(b);
  });

  it("strips revision markers for grouping", () => {
    expect(normalizeBiddingProjectName("Project Alpha Revised Quote")).toBe(
      normalizeBiddingProjectName("Project Alpha Rev 2")
    );
  });
});

describe("scoreProjectNameSimilarity", () => {
  it("scores exact normalized match highly", () => {
    const r = scoreProjectNameSimilarity(
      "Invitation to Bid — Falcon Warehouse",
      "Falcon Warehouse Quote"
    );
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.evidence).toContain("project_name_exact");
  });

  it("does not invent matches from weak tokens", () => {
    const r = scoreProjectNameSimilarity("Hospital Bid", "School Quote");
    expect(r.score).toBeLessThan(0.35);
  });
});

describe("resolveBidInviteSearchSinceAt", () => {
  it(`looks back ${BID_INVITE_LOOKBACK_DAYS} days before Quote range start`, () => {
    const quoteSince = new Date("2026-01-01T00:00:00.000Z");
    const inviteSince = resolveBidInviteSearchSinceAt(quoteSince);
    expect(inviteSince).not.toBeNull();
    const days =
      (quoteSince.getTime() - inviteSince!.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(BID_INVITE_LOOKBACK_DAYS);
  });

  it("returns null when Quote range is all history", () => {
    expect(resolveBidInviteSearchSinceAt(null)).toBeNull();
  });
});

describe("scoreEmailToQuoteProject", () => {
  it("matches exact project number deterministically", () => {
    const r = scoreEmailToQuoteProject({
      emailSubject: "25104 Falcon Bid Invite",
      quoteProjectName: "Falcon",
      quoteProjectNumber: "25104",
    });
    expect(r.evidence).toContain("project_number");
    expect(r.score).toBeGreaterThanOrEqual(0.55);
  });
});

describe("buildQuoteProjectGroupKey", () => {
  it("groups Quote revisions under one key", () => {
    const a = buildQuoteProjectGroupKey({
      projectName: "Project Alpha Quote",
      customerName: "Mortenson",
    });
    const b = buildQuoteProjectGroupKey({
      projectName: "Project Alpha Revised Quote",
      customerName: "Mortenson",
    });
    const c = buildQuoteProjectGroupKey({
      projectName: "Project Alpha Rev 2",
      customerName: "Mortenson",
    });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("keeps different projects separate despite similar customer", () => {
    const a = buildQuoteProjectGroupKey({
      projectName: "Alpha Tower",
      customerName: "Mortenson",
    });
    const b = buildQuoteProjectGroupKey({
      projectName: "Beta Tower",
      customerName: "Mortenson",
    });
    expect(a).not.toBe(b);
  });
});
