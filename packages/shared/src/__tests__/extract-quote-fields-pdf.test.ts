import { describe, expect, it } from "vitest";
import { extractQuoteFieldsDeterministic } from "../bidding/extract-quote-fields.js";
import {
  bidFieldsNeedAiEnrichment,
  quoteFieldsNeedAiEnrichment,
  quoteMatchNeedsAiAdjudication,
} from "../bidding/bid-extraction-completeness.js";
import {
  isPdfTextUsable,
  selectRelevantPdfText,
} from "../bidding/select-relevant-pdf-text.js";

describe("extractQuoteFieldsDeterministic with PDF text", () => {
  it("extracts amount from body first", () => {
    const r = extractQuoteFieldsDeterministic({
      subject: "Quote",
      bodyText: "Total: $180,000.00 for structural steel",
      pdfText: "TOTAL $999,999.00",
    });
    expect(r.amount).toBe(180000);
    expect(r.amountSource).toBe("EMAIL_BODY");
    expect(r.scope).toMatch(/steel/i);
  });

  it("extracts amount only in PDF when body lacks it", () => {
    const r = extractQuoteFieldsDeterministic({
      subject: "Our proposal",
      bodyText: "Please see attached.",
      pdfText: "QUOTE TOTAL PRICE: $184,500.00\nScope: Structural steel",
    });
    expect(r.amount).toBe(184500);
    expect(r.amountSource).toBe("PDF_TEXT");
    expect(r.scopeSource).toBe("PDF_TEXT");
  });

  it("preserves revision notes from PDF", () => {
    const r = extractQuoteFieldsDeterministic({
      subject: "Revised Quote",
      bodyText: "",
      pdfText: "Revision #2\nTotal: $50,000",
    });
    expect(r.notes).toMatch(/Revision/i);
    expect(r.amount).toBe(50000);
  });
});

describe("selectRelevantPdfText", () => {
  it("bounds large text and prefers signal windows", () => {
    const pad = "x".repeat(20_000);
    const text = `${pad}\nTOTAL PRICE $12,345.00\n${pad}`;
    const out = selectRelevantPdfText(text, 4000);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out).toMatch(/TOTAL PRICE/i);
  });

  it("marks short text unusable", () => {
    expect(isPdfTextUsable("")).toBe(false);
    expect(isPdfTextUsable("ab")).toBe(false);
    expect(isPdfTextUsable("This is a usable quote document with enough text")).toBe(
      true
    );
  });
});

describe("completeness gates", () => {
  it("skips AI when bid is complete", () => {
    expect(
      bidFieldsNeedAiEnrichment({
        projectName: "Prieto Battery",
        customerName: "CoBeck",
        bidDueAt: "2026-05-01",
        projectNumber: null,
      })
    ).toBe(false);
  });

  it("requests AI when project name missing", () => {
    expect(
      bidFieldsNeedAiEnrichment({
        projectName: null,
        customerName: "CoBeck",
        bidDueAt: "2026-05-01",
        projectNumber: null,
      })
    ).toBe(true);
  });

  it("requests quote AI when amount missing but PDF usable", () => {
    expect(
      quoteFieldsNeedAiEnrichment({
        amount: null,
        scope: "Structural steel",
        hasUsablePdfText: true,
      })
    ).toBe(true);
  });

  it("skips match AI when auto-link score", () => {
    expect(
      quoteMatchNeedsAiAdjudication({
        bestScore: 0.8,
        secondScore: 0.2,
        autoLinkThreshold: 0.55,
        reviewThreshold: 0.35,
      })
    ).toBe(false);
  });

  it("requests match AI in ambiguous band", () => {
    expect(
      quoteMatchNeedsAiAdjudication({
        bestScore: 0.45,
        secondScore: 0.42,
        autoLinkThreshold: 0.55,
        reviewThreshold: 0.35,
      })
    ).toBe(true);
  });
});
