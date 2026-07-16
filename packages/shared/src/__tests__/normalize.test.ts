import { describe, it, expect } from "vitest";
import { normalizeName, normalizeEmail, extractDomain, computeSimilarity, findDuplicates } from "../reference/normalize.js";

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  JE Dunn  ")).toBe("je dunn");
  });

  it("strips company suffixes", () => {
    expect(normalizeName("JE Dunn Construction Co.")).toBe("je dunn");
    expect(normalizeName("River City Erectors Inc.")).toBe("river city erectors");
    expect(normalizeName("Kraus-Anderson LLC")).toBe("kraus anderson");
  });

  it("normalizes punctuation and hyphens", () => {
    expect(normalizeName("Kraus-Anderson")).toBe("kraus anderson");
    expect(normalizeName("Kraus–Anderson")).toBe("kraus anderson");
  });

  it("normalizes ampersand", () => {
    expect(normalizeName("Smith & Jones")).toBe("smith and jones");
  });

  it("collapses whitespace", () => {
    expect(normalizeName("JE   Dunn")).toBe("je dunn");
  });

  it("strips apostrophes", () => {
    expect(normalizeName("O'Brien's")).toBe("obriens");
  });

  it("handles multiple suffixes", () => {
    expect(normalizeName("ABC Corp Inc")).toBe("abc");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  John@Example.COM  ")).toBe("john@example.com");
  });
});

describe("extractDomain", () => {
  it("extracts domain", () => {
    expect(extractDomain("john@example.com")).toBe("example.com");
  });

  it("returns null for invalid email", () => {
    expect(extractDomain("nope")).toBeNull();
  });
});

describe("computeSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(computeSimilarity("je dunn", "je dunn")).toBe(1.0);
  });

  it("returns 0 for empty strings", () => {
    expect(computeSimilarity("", "test")).toBe(0);
  });

  it("returns high score for overlapping tokens", () => {
    const score = computeSimilarity("je dunn", "je dunn construction");
    expect(score).toBeGreaterThan(0.6);
  });

  it("returns low score for different strings", () => {
    const score = computeSimilarity("abc xyz", "def ghi");
    expect(score).toBe(0);
  });
});

describe("findDuplicates", () => {
  const entries = [
    { id: "1", name: "JE Dunn", normalizedName: "je dunn" },
    { id: "2", name: "Kraus-Anderson", normalizedName: "kraus anderson" },
    { id: "3", name: "River City Erectors", normalizedName: "river city erectors" }
  ];

  it("finds exact match", () => {
    const dupes = findDuplicates("je dunn", "JE Dunn", entries);
    expect(dupes.length).toBeGreaterThan(0);
    expect(dupes[0]!.score).toBe(1.0);
    expect(dupes[0]!.matchType).toBe("exact");
  });

  it("finds normalized match (collapsed whitespace/hyphens)", () => {
    const dupes = findDuplicates("jedunn", "JeDunn", entries);
    expect(dupes.length).toBeGreaterThan(0);
    expect(dupes[0]!.score).toBe(0.95);
    expect(dupes[0]!.matchType).toBe("normalized");
  });

  it("finds fuzzy match", () => {
    const dupes = findDuplicates("river city erectors", "River City Erectors Inc.", entries);
    expect(dupes.length).toBeGreaterThan(0);
    expect(dupes[0]!.existingId).toBe("3");
  });

  it("returns empty for no match", () => {
    const dupes = findDuplicates("completely different company", "Completely Different", entries);
    expect(dupes.length).toBe(0);
  });

  it("limits results to 5", () => {
    const manyEntries = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      name: `Test Company ${i}`,
      normalizedName: `test company ${i}`
    }));
    const dupes = findDuplicates("test company", "Test Company", manyEntries);
    expect(dupes.length).toBeLessThanOrEqual(5);
  });
});
