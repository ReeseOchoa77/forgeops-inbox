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
import { emptyDetailedScope } from "../bidding/scope-detail.js";

describe("extractQuoteFieldsDeterministic with PDF text", () => {
  it("extracts amount from body first", () => {
    const r = extractQuoteFieldsDeterministic({
      subject: "Quote",
      bodyText: "Total: $180,000.00 for structural steel",
      pdfText: "TOTAL $999,999.00",
    });
    expect(r.amount).toBe(180000);
    expect(r.amountSource).toBe("EMAIL_BODY");
    expect(r.scopeDetail.tradeCategory).toMatch(/steel/i);
    expect(r.scopeDetail.detailedComplete).toBe(false);
  });

  it("extracts amount only in PDF when body lacks it", () => {
    const r = extractQuoteFieldsDeterministic({
      subject: "Our proposal",
      bodyText: "Please see attached.",
      pdfText: "QUOTE TOTAL PRICE: $184,500.00\nScope: Structural steel",
    });
    expect(r.amount).toBe(184500);
    expect(r.amountSource).toBe("PDF_TEXT");
    expect(r.scopeDetail.tradeCategory).toMatch(/structural steel/i);
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

  it("keeps Bid vs Quote scope independence at extract layer", () => {
    const quote = extractQuoteFieldsDeterministic({
      bodyText: "Quote covers stairs and rails only. Total $10,000",
    });
    expect(quote.scopeDetail.items.map((i) => i.name.toLowerCase())).toEqual(
      expect.arrayContaining(["stairs", "railings"])
    );
    // Bid extract would be separate — quote extract does not invent framing.
    expect(
      quote.scopeDetail.items.some((i) => /beam|column/i.test(i.name))
    ).toBe(false);
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
  it("skips AI when bid identity is complete and scope already detailed", () => {
    expect(
      bidFieldsNeedAiEnrichment({
        projectName: "Prieto Battery",
        customerName: "CoBeck",
        bidDueAt: "2026-05-01",
        projectNumber: null,
        scopeDetailComplete: true,
        hasScopeEvidence: true,
      })
    ).toBe(false);
  });

  it("requests AI when detailed scope incomplete with evidence", () => {
    expect(
      bidFieldsNeedAiEnrichment({
        projectName: "Prieto Battery",
        customerName: "CoBeck",
        bidDueAt: "2026-05-01",
        projectNumber: null,
        scopeDetailComplete: false,
        hasScopeEvidence: true,
      })
    ).toBe(true);
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

  it("requests quote AI when only generic trade scope present", () => {
    expect(
      quoteFieldsNeedAiEnrichment({
        amount: 180000,
        scope: "Structural steel",
        scopeDetail: emptyDetailedScope({
          tradeCategory: "Structural steel",
          detailedComplete: false,
        }),
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
