import { describe, expect, it } from "vitest";
import {
  emptyBidFieldExtractionResult,
  OpenAIBidFieldExtractor,
} from "../bidding-analysis/bid-field-extraction.js";
import {
  emptyQuoteFieldExtractionResult,
  OpenAIQuoteFieldExtractor,
} from "../bidding-analysis/quote-field-extraction.js";
import {
  emptyQuoteMatchAdjudicationResult,
  OpenAIQuoteMatchAdjudicator,
} from "../bidding-analysis/match-adjudication.js";

describe("bidding-analysis extractors without client", () => {
  it("bid extractor returns empty when unconfigured", async () => {
    const ex = new OpenAIBidFieldExtractor(null);
    expect(ex.isConfigured()).toBe(false);
    const r = await ex.extract({
      subject: "ITB Foo",
      bodyText: "Bid due Friday",
      deterministic: {
        projectName: null,
        customerName: null,
        projectNumber: null,
        bidDueDate: null,
        scope: null,
        notes: null,
      },
    });
    expect(r).toEqual(emptyBidFieldExtractionResult());
  });

  it("quote extractor returns empty when unconfigured", async () => {
    const ex = new OpenAIQuoteFieldExtractor(null);
    const r = await ex.extract({
      subject: "Quote",
      bodyText: "",
      deterministic: {
        scope: null,
        amount: null,
        currency: null,
        notes: null,
      },
    });
    expect(r).toEqual(emptyQuoteFieldExtractionResult());
  });

  it("match adjudicator returns insufficient when unconfigured", async () => {
    const ex = new OpenAIQuoteMatchAdjudicator(null);
    const r = await ex.adjudicate({
      quote: {
        subject: "Q",
        scope: null,
        amount: null,
        projectHints: [],
        attachmentNames: [],
      },
      shortlist: [
        {
          id: "c1",
          projectName: "A",
          jobNumber: null,
          customerName: null,
          score: 0.4,
          evidence: [],
        },
      ],
    });
    expect(r).toEqual(emptyQuoteMatchAdjudicationResult());
  });
});
