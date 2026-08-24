import { describe, expect, it } from "vitest";

import {
  buildParityDiagnostics,
  compareExact,
  compareNullableExact,
  compareNumeric,
  compareStringArrayExact,
  compareSummarySideBySide,
  compareTaskLists,
  isExactMismatch,
  isNumericVariance,
  isUnavailable,
} from "../reference/classification-parity-compare.js";

describe("classification parity compare helpers", () => {
  it("returns numeric absoluteDifference", () => {
    const result = compareNumeric(0.8, 0.85);
    expect(result).toMatchObject({ n8n: 0.8, native: 0.85 });
    if ("absoluteDifference" in result) {
      expect(result.absoluteDifference).toBeCloseTo(0.05, 10);
    }
  });

  it("marks unavailable historical numeric/categorical fields", () => {
    expect(compareNumeric(null, 0.4)).toEqual({
      n8n: null,
      native: 0.4,
      matches: null,
      unavailable: true,
    });
    expect(compareExact(null, "BUSINESS")).toMatchObject({
      unavailable: true,
      matches: null,
    });
  });

  it("treats historical null entity ids as comparable when available", () => {
    expect(compareNullableExact(null, null, true)).toEqual({
      n8n: null,
      native: null,
      matches: true,
    });
    expect(compareNullableExact(null, "c1", true)).toEqual({
      n8n: null,
      native: "c1",
      matches: false,
    });
    expect(compareNullableExact(null, "c1", false)).toMatchObject({
      unavailable: true,
    });
  });

  it("compares matchEvidence as sorted string sets", () => {
    expect(
      compareStringArrayExact(["b", "a"], ["a", "b"], true).matches
    ).toBe(true);
    expect(
      compareStringArrayExact(["a"], ["a", "b"], true).matches
    ).toBe(false);
  });

  it("compares task semantics without requiring description equality", () => {
    const result = compareTaskLists(
      [
        {
          title: "Review Quote",
          description: "n8n wording A",
          dueDate: null,
          recommendedOwner: "Alex",
          confidence: 0.8,
        },
      ],
      [
        {
          title: "review quote",
          description: "native wording B",
          dueDate: null,
          recommendedOwner: "Alex",
          confidence: 0.82,
        },
      ]
    );

    expect(result.taskCount.matches).toBe(true);
    expect(result.titleSetMatches).toBe(true);
    expect(result.rows[0]?.titleMatches).toBe(true);
    expect(result.rows[0]?.n8nDescription).toBe("n8n wording A");
    expect(result.rows[0]?.nativeDescription).toBe("native wording B");
    expect(result.rows[0]?.dueDate.matches).toBe(true);
    expect(result.rows[0]?.recommendedOwner.matches).toBe(true);
    expect(
      "absoluteDifference" in result.rows[0]!.confidence &&
        result.rows[0]!.confidence.absoluteDifference
    ).toBeCloseTo(0.02, 10);
  });

  it("flags TASK_MISMATCH when normalized titles differ", () => {
    const result = compareTaskLists(
      [
        {
          title: "Send invoice",
          description: null,
          dueDate: null,
          recommendedOwner: null,
          confidence: 0.9,
        },
      ],
      [
        {
          title: "Call vendor",
          description: "Different action",
          dueDate: null,
          recommendedOwner: null,
          confidence: 0.9,
        },
      ]
    );
    expect(result.titleSetMatches).toBe(false);
  });

  it("does not require summary exact equality", () => {
    const summary = compareSummarySideBySide("n8n summary", "native summary");
    expect(summary.exactMatches).toBe(false);
    expect(summary.n8n).toBe("n8n summary");
    expect(summary.native).toBe("native summary");
  });

  it("builds complete BUSINESS match diagnostics", () => {
    expect(
      buildParityDiagnostics({
        hasMeaningfulComparisonBasis: true,
        mailboxCategoryMatches: true,
        decisionRuleMatches: true,
        signalVariance: false,
        subtypeMismatch: false,
        entityMismatch: false,
        taskMismatch: false,
        priorityMismatch: false,
      })
    ).toEqual(["MATCH"]);
  });

  it("allows multiple diagnostic reasons", () => {
    expect(
      buildParityDiagnostics({
        hasMeaningfulComparisonBasis: true,
        mailboxCategoryMatches: false,
        decisionRuleMatches: false,
        signalVariance: true,
        subtypeMismatch: true,
        entityMismatch: true,
        taskMismatch: true,
        priorityMismatch: true,
      })
    ).toEqual([
      "DECISION_MISMATCH",
      "SUBTYPE_MISMATCH",
      "ENTITY_MISMATCH",
      "TASK_MISMATCH",
      "PRIORITY_MISMATCH",
      "SIGNAL_VARIANCE",
    ]);
  });

  it("returns INSUFFICIENT_HISTORICAL_DATA alone when basis missing", () => {
    expect(
      buildParityDiagnostics({
        hasMeaningfulComparisonBasis: false,
        mailboxCategoryMatches: false,
        decisionRuleMatches: false,
        signalVariance: true,
        subtypeMismatch: true,
        entityMismatch: true,
        taskMismatch: true,
        priorityMismatch: true,
      })
    ).toEqual(["INSUFFICIENT_HISTORICAL_DATA"]);
  });

  it("detects subtype / entity / priority mismatches without counting unavailable", () => {
    const subtype = compareNullableExact("VENDOR_QUOTE", "CHANGE_ORDER", true);
    const entity = compareNullableExact("c1", "c2", true);
    const priority = compareExact("HIGH", "NORMAL");
    const unavailable = compareNumeric(null, 0.5);

    expect(isExactMismatch(subtype)).toBe(true);
    expect(isExactMismatch(entity)).toBe(true);
    expect(isExactMismatch(priority)).toBe(true);
    expect(isUnavailable(unavailable)).toBe(true);
    expect(isNumericVariance(unavailable)).toBe(false);
  });
});

describe("PERSONAL skips business-only comparisons", () => {
  it("documents unavailable business fields for PERSONAL routing", () => {
    // Parity runner marks subtype/entities/tasks unavailable when native is PERSONAL.
    const skippedSubtype = compareNullableExact("VENDOR_QUOTE", null, false);
    const skippedEntity = compareNullableExact("c1", null, false);
    expect(isUnavailable(skippedSubtype)).toBe(true);
    expect(isUnavailable(skippedEntity)).toBe(true);
    expect(isExactMismatch(skippedSubtype)).toBe(false);
  });
});
