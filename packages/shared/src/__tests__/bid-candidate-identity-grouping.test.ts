import { describe, expect, it } from "vitest";
import {
  buildBidCandidateIdentityKey,
  buildQuoteProjectGroupKey,
  isTrustworthyBiddingProjectNumber,
  quoteGroupKeyBasisLabel,
} from "../bidding/bid-candidate-identity.js";

describe("isTrustworthyBiddingProjectNumber", () => {
  it("rejects short generics and calendar years", () => {
    for (const n of ["01", "02", "03", "25", "26", "1", "99", "2025", "2026"]) {
      expect(isTrustworthyBiddingProjectNumber(n)).toBe(false);
    }
  });

  it("accepts distinctive plain and yy-seq shop numbers", () => {
    expect(isTrustworthyBiddingProjectNumber("25104")).toBe(true);
    expect(isTrustworthyBiddingProjectNumber("2209")).toBe(true);
    expect(isTrustworthyBiddingProjectNumber("104")).toBe(true);
    expect(isTrustworthyBiddingProjectNumber("26-200")).toBe(true);
  });
});

describe("buildQuoteProjectGroupKey — weak number safety", () => {
  it("A) does not group ESC PR-01 with an unrelated project that also has 01", () => {
    const esc = buildQuoteProjectGroupKey({
      projectNumber: "01",
      projectName: "ESC Swing Space - Added PR-01 Steel Scope",
      customerName: "Vendor A",
    });
    const zayo = buildQuoteProjectGroupKey({
      projectNumber: "01",
      projectName: "Zayo Group Fiber Build",
      customerName: "Vendor B",
    });
    const morries = buildQuoteProjectGroupKey({
      projectNumber: "01",
      projectName: "Morries Cadillac Renovation",
      customerName: "Vendor C",
    });

    expect(esc).toBeTruthy();
    expect(zayo).toBeTruthy();
    expect(morries).toBeTruthy();
    expect(esc).not.toBe(zayo);
    expect(esc).not.toBe(morries);
    expect(zayo).not.toBe(morries);
    expect(esc?.startsWith("qnum:")).toBe(false);
    expect(esc?.startsWith("qname:")).toBe(true);
  });

  it("B) does not group unrelated Quotes merely because both contain year 2026", () => {
    const a = buildQuoteProjectGroupKey({
      projectNumber: "2026",
      projectName: "North Campus Expansion",
      customerName: "GC One",
    });
    const b = buildQuoteProjectGroupKey({
      projectNumber: "2026",
      projectName: "Harbor Bridge Repair",
      customerName: "GC Two",
    });
    expect(a).not.toBe(b);
    expect(a?.startsWith("qnum:")).toBe(false);
  });

  it("C) groups revisions that share a distinctive project number", () => {
    const a = buildQuoteProjectGroupKey({
      projectNumber: "25104",
      projectName: "Project Falcon Quote",
      customerName: "Mortenson",
    });
    const b = buildQuoteProjectGroupKey({
      projectNumber: "25104",
      projectName: "Project Falcon Revised Quote",
      customerName: "Different Sender",
    });
    expect(a).toBe("qnum:25104");
    expect(b).toBe("qnum:25104");
    expect(quoteGroupKeyBasisLabel(a!)).toBe("group_by_strong_project_number");
  });

  it("D) still groups Quote / Revised Quote by normalized project identity", () => {
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
    expect(quoteGroupKeyBasisLabel(a!)).toBe("group_by_project_name_customer");
  });

  it("F) keeps different projects separate with same customer (name path)", () => {
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

  it("weak number alone falls back to message singleton (no qnum)", () => {
    const key = buildQuoteProjectGroupKey({
      projectNumber: "01",
      fallbackMessageId: "msg-esc-1",
    });
    expect(key).toBe("qmsg:msg-esc-1");
  });
});

describe("buildBidCandidateIdentityKey — weak number collision protection", () => {
  it("E) does not collapse distinct Quote groups that both receive weak number 01", () => {
    const esc = buildBidCandidateIdentityKey({
      projectNumber: "01",
      projectName: "ESC Swing Space - Added PR-01 Steel Scope",
      customerName: "Vendor A",
      fallbackMessageId: "q1",
    });
    const zayo = buildBidCandidateIdentityKey({
      projectNumber: "01",
      projectName: "Zayo Group Fiber Build",
      customerName: "Vendor B",
      fallbackMessageId: "q2",
    });
    expect(esc).not.toBe(zayo);
    expect(esc?.startsWith("num:")).toBe(false);
    expect(zayo?.startsWith("num:")).toBe(false);
  });

  it("F) still uses distinctive numbers as Candidate identity", () => {
    expect(
      buildBidCandidateIdentityKey({
        projectNumber: "25104",
        projectName: "Project Falcon",
      })
    ).toBe("num:25104");
  });

  it("year alone does not become Candidate num: identity", () => {
    const a = buildBidCandidateIdentityKey({
      projectNumber: "2026",
      projectName: "North Campus",
      fallbackMessageId: "m1",
    });
    const b = buildBidCandidateIdentityKey({
      projectNumber: "2026",
      projectName: "Harbor Bridge",
      fallbackMessageId: "m2",
    });
    expect(a).not.toBe(b);
    expect(a?.startsWith("num:")).toBe(false);
  });
});
