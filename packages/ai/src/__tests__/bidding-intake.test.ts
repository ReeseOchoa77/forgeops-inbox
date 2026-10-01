import { describe, expect, it } from "vitest";
import { parseBiddingIntakeResult } from "../bidding-intake/parse.js";
import {
  biddingIntakeSystemPrompt,
  emptyBiddingIntakeResult,
} from "../bidding-intake/prompt.js";

describe("bidding intake AI parse", () => {
  it("accepts projectName + alternates + bidDueDate + customerCompanyName", () => {
    expect(
      parseBiddingIntakeResult({
        projectName: "Forté - EP Office Expansion",
        alternateProjectNames: ["EP Office Expansion"],
        bidDueDate: "2026-10-15",
        customerCompanyName: "Mortenson",
      })
    ).toEqual({
      projectName: "Forté - EP Office Expansion",
      alternateProjectNames: ["EP Office Expansion"],
      bidDueDate: "2026-10-15",
      customerCompanyName: "Mortenson",
    });
  });

  it("defaults missing alternateProjectNames to []", () => {
    expect(
      parseBiddingIntakeResult({
        projectName: "Ok",
        bidDueDate: "2026-10-15",
        customerCompanyName: null,
      })
    ).toEqual({
      projectName: "Ok",
      alternateProjectNames: [],
      bidDueDate: "2026-10-15",
      customerCompanyName: null,
    });
  });

  it("empty result helper is blank", () => {
    expect(emptyBiddingIntakeResult()).toEqual({
      projectName: null,
      alternateProjectNames: [],
      bidDueDate: null,
      customerCompanyName: null,
    });
  });

  it("prompt encodes PDF-first project priority and generic rejection", () => {
    expect(biddingIntakeSystemPrompt).toContain("PDF filenames");
    expect(biddingIntakeSystemPrompt).toContain("alternateProjectNames");
    expect(biddingIntakeSystemPrompt).toContain("A101.pdf");
    expect(biddingIntakeSystemPrompt).toContain("Structural Drawings.pdf");
    expect(biddingIntakeSystemPrompt).toContain("customerCompanyName");
  });
});
