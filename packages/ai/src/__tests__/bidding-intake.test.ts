import { describe, expect, it } from "vitest";
import { parseBiddingIntakeResult } from "../bidding-intake/parse.js";
import {
  biddingIntakeSystemPrompt,
  emptyBiddingIntakeResult,
} from "../bidding-intake/prompt.js";

describe("bidding intake AI parse", () => {
  it("accepts projectName + bidDueDate + customerCompanyName", () => {
    expect(
      parseBiddingIntakeResult({
        projectName: "Garden City Elementary",
        bidDueDate: "2026-10-15",
        customerCompanyName: "Mortenson",
      })
    ).toEqual({
      projectName: "Garden City Elementary",
      bidDueDate: "2026-10-15",
      customerCompanyName: "Mortenson",
    });
  });

  it("accepts nulls (prefer blank over guessing)", () => {
    expect(
      parseBiddingIntakeResult({
        projectName: null,
        bidDueDate: null,
        customerCompanyName: null,
      })
    ).toEqual({
      projectName: null,
      bidDueDate: null,
      customerCompanyName: null,
    });
  });

  it("defaults missing customerCompanyName to null", () => {
    expect(
      parseBiddingIntakeResult({
        projectName: "Ok",
        bidDueDate: "2026-10-15",
      })
    ).toEqual({
      projectName: "Ok",
      bidDueDate: "2026-10-15",
      customerCompanyName: null,
    });
  });

  it("treats invalid bidDueDate as null rather than inventing", () => {
    expect(
      parseBiddingIntakeResult({
        projectName: "Ok",
        bidDueDate: "October 15",
        customerCompanyName: null,
      })
    ).toEqual({
      projectName: "Ok",
      bidDueDate: null,
      customerCompanyName: null,
    });
  });

  it("empty result helper is blank", () => {
    expect(emptyBiddingIntakeResult()).toEqual({
      projectName: null,
      bidDueDate: null,
      customerCompanyName: null,
    });
  });

  it("prompt encodes subject-first org rules and exclusions", () => {
    expect(biddingIntakeSystemPrompt).toContain("EMAIL SUBJECT");
    expect(biddingIntakeSystemPrompt).toContain("customerCompanyName");
    expect(biddingIntakeSystemPrompt).toContain("BuildingConnected");
    expect(biddingIntakeSystemPrompt).toContain("individual person's name");
    expect(biddingIntakeSystemPrompt).toContain("project name");
  });
});
