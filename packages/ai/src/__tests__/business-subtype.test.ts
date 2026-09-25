import { describe, expect, it } from "vitest";

import { parseBusinessSubtypeResult } from "../business-subtype/parse.js";
import { BUSINESS_SUBTYPE_KEYS } from "../business-subtype/prompt.js";
import { StructuredOutputValidationError } from "../openai/responses-json.js";

describe("business subtype contract", () => {
  it("accepts every allowed enum value", () => {
    for (const businessType of BUSINESS_SUBTYPE_KEYS) {
      expect(
        parseBusinessSubtypeResult({
          businessType,
          businessTypeConfidence: 0.9,
          competingType: null,
          evidence: ["subject states the workflow"],
        })
      ).toMatchObject({
        businessType,
        businessTypeConfidence: 0.9,
        competingType: null,
        classifierVersion: "subtype-v2",
      });
    }
  });

  it("rejects invented subtype keys", () => {
    expect(() =>
      parseBusinessSubtypeResult({
        businessType: "BID_INVITATION",
        businessTypeConfidence: 0.9,
        competingType: null,
        evidence: ["subject"],
      })
    ).toThrow(StructuredOutputValidationError);
  });

  it("rejects confidence outside 0–1 and extra fields", () => {
    expect(() =>
      parseBusinessSubtypeResult({
        businessType: "OTHER_BUSINESS",
        businessTypeConfidence: 1.2,
        competingType: null,
        evidence: ["subject"],
      })
    ).toThrow(/between 0 and 1/);

    expect(() =>
      parseBusinessSubtypeResult({
        businessType: "OTHER_BUSINESS",
        businessTypeConfidence: 0.5,
        competingType: null,
        evidence: ["subject"],
        mailboxCategory: "BUSINESS",
      })
    ).toThrow(/unexpected property/);
  });
});
