import { describe, expect, it } from "vitest";
import {
  extractDetailedScopeDeterministic,
  finalizeDetailedScope,
  formatScopeSummary,
  isDetailedScopeComplete,
  isGenericScopeLabel,
  isScopeReviewPlaceholder,
  mergeAiScopeDetail,
  detailedScopeFromUserLists,
  scopeDetailFromUserText,
  scopeSummaryString,
} from "../bidding/scope-detail.js";

describe("extractDetailedScopeDeterministic", () => {
  it("does not invent items from generic Structural Steel", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "ITB — Structural Steel",
      bodyText: "Please bid structural steel for this project.",
    });
    expect(d.tradeCategory).toMatch(/structural steel/i);
    expect(d.items).toEqual([]);
    expect(isDetailedScopeComplete(d)).toBe(false);
    expect(d.summary).toBeNull();
    expect(scopeSummaryString(d)).toBeNull();
  });

  it("1) work-only furnish/install → detailedComplete=false", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "ITB",
      bodyText: "Please furnish and install per plans.",
    });
    expect(d.items).toEqual([]);
    expect(d.work.length).toBeGreaterThan(0);
    expect(isDetailedScopeComplete(d)).toBe(false);
    expect(d.summary).toBeNull();
    expect(isScopeReviewPlaceholder(d.summary)).toBe(false);
  });

  it("2) Scope needs review is never a meaningful summary", () => {
    expect(isScopeReviewPlaceholder("Scope needs review")).toBe(true);
    expect(isScopeReviewPlaceholder("Structural steel · Needs Review")).toBe(
      true
    );
    expect(isScopeReviewPlaceholder("3 items: Stairs, Handrails")).toBe(false);
    const forced = finalizeDetailedScope({
      tradeCategory: null,
      items: [],
      work: [
        { name: "Furnish/supply", kind: "WORK" },
        { name: "Installation", kind: "WORK" },
      ],
      exclusions: [],
      qualifications: [],
      summary: "Scope needs review",
      detailedComplete: true,
      extractionMethod: "DETERMINISTIC",
    });
    expect(forced.detailedComplete).toBe(false);
    expect(forced.summary).toBeNull();
  });

  it("3) source identifies stairs + handrails → items", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "Bid invite",
      bodyText: "Provide steel stairs S1 and S2 with handrails.",
    });
    const names = d.items.map((i) => i.name.toLowerCase());
    expect(names).toEqual(
      expect.arrayContaining(["steel stairs", "handrails"])
    );
    expect(isDetailedScopeComplete(d)).toBe(true);
  });

  it("4) stairs only → do not invent railings/beams/columns", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "ITB",
      bodyText: "Furnish steel stairs only.",
    });
    const names = d.items.map((i) => i.name.toLowerCase());
    expect(names).toEqual(expect.arrayContaining(["steel stairs"]));
    expect(names.some((n) => /rail|beam|column/i.test(n))).toBe(false);
  });

  it("5) uses PDF text when richer than email body", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "See attached",
      bodyText: "Please furnish and install. See PDF.",
      pdfText: "Miscellaneous metals: ladders, bollards, embeds",
    });
    expect(d.tradeCategory).toMatch(/miscellaneous metals/i);
    const names = d.items.map((i) => i.name.toLowerCase());
    expect(names).toEqual(
      expect.arrayContaining(["ladders", "bollards", "embeds"])
    );
    expect(isDetailedScopeComplete(d)).toBe(true);
  });

  it("6) no useful evidence → incomplete, no invented items", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "Hello",
      bodyText: "Thanks",
    });
    expect(d.items).toEqual([]);
    expect(isDetailedScopeComplete(d)).toBe(false);
    expect(formatScopeSummary(d)).toBeNull();
  });

  it("11) complete meaningful scope → detailedComplete=true", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "Bid invite",
      bodyText: "Provide beams, columns, steel stairs and handrails.",
    });
    expect(isDetailedScopeComplete(d)).toBe(true);
    expect(d.summary).toMatch(/item/i);
    expect(scopeSummaryString(d)).toBeTruthy();
  });

  it("extracts work and exclusions when evidence supports them", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "Quote",
      bodyText: "Furnish and install stairs and rails. Painting by others.",
    });
    expect(d.items.map((i) => i.name.toLowerCase())).toEqual(
      expect.arrayContaining(["stairs", "railings"])
    );
    expect(d.work.some((w) => /furnish|install/i.test(w.name))).toBe(true);
    expect(d.exclusions.some((e) => /paint/i.test(e.name))).toBe(true);
  });
});

describe("mergeAiScopeDetail anti-hallucination", () => {
  it("ignores generic AI item names", () => {
    const base = extractDetailedScopeDeterministic({
      bodyText: "Structural Steel only.",
    });
    const merged = mergeAiScopeDetail(base, {
      tradeCategory: "Structural steel",
      items: [
        { name: "Structural Steel", details: null },
        { name: "Beams", details: null },
      ],
      work: [],
      exclusions: [],
      qualifications: [],
    });
    expect(merged.items.every((i) => !isGenericScopeLabel(i.name))).toBe(true);
  });

  it("does not treat empty AI invent as complete when base is trade-only", () => {
    const base = extractDetailedScopeDeterministic({
      bodyText: "Structural Steel",
    });
    const merged = mergeAiScopeDetail(base, {
      tradeCategory: "Structural steel",
      items: [],
      work: [],
      exclusions: [],
      qualifications: [],
    });
    expect(isDetailedScopeComplete(merged)).toBe(false);
  });
});

describe("scopeDetailFromUserText", () => {
  it("7) user-edited scope stores items and marks USER_EDITED", () => {
    const d = scopeDetailFromUserText("Beams\nColumns\nHandrails");
    expect(d.extractionMethod).toBe("USER_EDITED");
    expect(d.items.map((i) => i.name)).toEqual([
      "Beams",
      "Columns",
      "Handrails",
    ]);
    expect(isDetailedScopeComplete(d)).toBe(true);
  });
});

describe("detailedScopeFromUserLists", () => {
  it("keeps items and work as structured USER_EDITED rows", () => {
    const d = detailedScopeFromUserLists({
      items: ["Beams", "Columns", "Stairs"],
      work: ["Furnish", "Fabricate", "Install"],
      exclusions: ["Painting"],
    });
    expect(d.extractionMethod).toBe("USER_EDITED");
    expect(d.items.map((i) => i.name)).toEqual(["Beams", "Columns", "Stairs"]);
    expect(d.work.map((w) => w.name)).toEqual([
      "Furnish",
      "Fabricate",
      "Install",
    ]);
    expect(d.exclusions.map((e) => e.name)).toEqual(["Painting"]);
    expect(d.detailedComplete).toBe(true);
  });
});
