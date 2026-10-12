import { describe, expect, it } from "vitest";
import {
  extractDetailedScopeDeterministic,
  isDetailedScopeComplete,
  isGenericScopeLabel,
  mergeAiScopeDetail,
  scopeDetailFromUserText,
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
    expect(d.summary).toMatch(/Needs Review/i);
  });

  it("extracts concrete items from explicit language", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "Bid invite",
      bodyText: "Provide beams, columns, steel stairs and handrails.",
    });
    const names = d.items.map((i) => i.name.toLowerCase());
    expect(names).toEqual(
      expect.arrayContaining(["beams", "columns", "steel stairs", "handrails"])
    );
    expect(isDetailedScopeComplete(d)).toBe(true);
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

  it("extracts misc metals items from PDF-only text", () => {
    const d = extractDetailedScopeDeterministic({
      subject: "See attached",
      bodyText: "Please see PDF.",
      pdfText: "Miscellaneous metals: ladders, bollards, embeds",
    });
    expect(d.tradeCategory).toMatch(/miscellaneous metals/i);
    const names = d.items.map((i) => i.name.toLowerCase());
    expect(names).toEqual(
      expect.arrayContaining(["ladders", "bollards", "embeds"])
    );
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
    // Generic label dropped; concrete Beams kept only if AI provided it —
    // but for "Structural Steel only" evidence we still accept AI Beams only
    // when model returns them; here we verify generic is not kept as item.
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
  it("stores user lines as items and marks USER_EDITED", () => {
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
