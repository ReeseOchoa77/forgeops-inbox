import { describe, expect, it } from "vitest";
import { extractQuoteFieldsDeterministic } from "../bidding/extract-quote-fields.js";

describe("extractQuoteFieldsDeterministic", () => {
  it("extracts scope and amount from body without hallucinating", () => {
    const r = extractQuoteFieldsDeterministic({
      subject: "RE: Maple Grove DC Quote",
      bodyText: "Please find our structural steel quote.\nTotal: $184,500.00\nExcludes erection.",
    });
    // Scope summary reflects trade + detailed-scope completeness signaling.
    expect(r.scope).toMatch(/Structural steel/i);
    expect(r.scopeDetail.tradeCategory?.toLowerCase()).toContain("structural");
    expect(r.amount).toBe(184500);
    expect(r.currency).toBe("USD");
    expect(r.notes).toMatch(/Excludes erection/i);
  });

  it("returns null amount when no reliable money cue", () => {
    const r = extractQuoteFieldsDeterministic({
      subject: "Steel Quote",
      bodyText: "See attached. Call me at 555-1212.",
    });
    expect(r.amount).toBeNull();
    expect(r.currency).toBeNull();
  });
});
