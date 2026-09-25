import { describe, expect, it } from "vitest";

import { isolateCurrentMessage } from "../business-subtype/evidence-packet.js";
import { scoreSubtypeEvaluation, SUBTYPE_GOLDEN_SET } from "../business-subtype/evaluate.js";
import { buildBusinessSubtypeUserPrompt } from "../business-subtype/prompt.js";

describe("subtype evidence packet", () => {
  it("keeps the current reply and drops quoted history and the signature", () => {
    const current = isolateCurrentMessage(
      [
        "Approved.",
        "Thanks,",
        "Estimator",
        "Project Manager",
        "",
        "On Monday Alex wrote:",
        "Please review the shop drawings.",
      ].join("\n")
    );
    expect(current).toBe("Approved.");
  });

  it("puts subject, filenames, and job identity in the prompt without the quoted chain", () => {
    const prompt = buildBusinessSubtypeUserPrompt({
      normalizedSubject: "Submittal 05 12 00",
      senderEmail: "pm@gc.example",
      cleanBody: "Please approve.\n\nOn Monday Alex wrote:\nOld pricing thread.",
      attachmentNames: ["Submittal_051200.pdf"],
      activeBusinessTypes: [],
      job: { name: "Nova Academy Addition", jobNumber: "2198" },
    });
    expect(prompt).toContain("Subject: Submittal 05 12 00");
    expect(prompt).toContain("Submittal_051200.pdf");
    expect(prompt).toContain("Nova Academy Addition");
    expect(prompt).toContain("does not imply a subtype");
    expect(prompt).not.toContain("Old pricing thread");
  });
});

describe("subtype evaluation harness", () => {
  it("scores a known confusion without calling a model", () => {
    const cases = SUBTYPE_GOLDEN_SET.map((row) => ({ id: row.id, expected: row.expected }));
    const predictions = SUBTYPE_GOLDEN_SET.map((row) => ({
      id: row.id,
      predicted:
        row.id === "pricing-with-drawings" ? ("SUBMITTAL_SHOP_DRAWING" as const) : row.expected,
      confidence: row.id === "thin-reply" ? 0.4 : 0.9,
    }));
    const report = scoreSubtypeEvaluation(cases, predictions);
    expect(report.total).toBe(SUBTYPE_GOLDEN_SET.length);
    expect(report.correct).toBe(SUBTYPE_GOLDEN_SET.length - 1);
    expect(report.accuracy).toBeCloseTo((SUBTYPE_GOLDEN_SET.length - 1) / SUBTYPE_GOLDEN_SET.length);
    expect(report.confusion).toContainEqual({
      expected: "ESTIMATE_QUOTE",
      predicted: "SUBMITTAL_SHOP_DRAWING",
      count: 1,
    });
    expect(report.lowConfidence.map((row) => row.id)).toEqual(["thin-reply"]);
    const quote = report.perSubtype.find((row) => row.subtype === "ESTIMATE_QUOTE");
    expect(quote?.recall).toBe(0);
  });
});
