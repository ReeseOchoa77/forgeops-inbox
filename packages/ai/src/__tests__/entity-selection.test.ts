import { describe, expect, it } from "vitest";

import { parseEntitySelectionResult } from "../entity-selection/parse.js";
import { StructuredOutputValidationError } from "../openai/responses-json.js";

const context = {
  customerCandidates: [{ id: "c1", name: "Acme" }],
  vendorCandidates: [{ id: "v1", name: "SteelCo" }],
  jobCandidates: [{ id: "j1", name: "Project 42" }],
  candidateLookupFailed: false,
};

describe("entity selection anti-fabrication", () => {
  it("accepts exact candidate IDs", () => {
    expect(
      parseEntitySelectionResult(
        {
          selectedCustomerId: "c1",
          selectedVendorId: null,
          selectedJobId: "j1",
          entityMatchConfidence: 0.88,
          matchEvidence: ["sender domain matches Acme", "subject has Project 42"],
        },
        context
      )
    ).toMatchObject({
      selectedCustomerId: "c1",
      selectedVendorId: null,
      selectedJobId: "j1",
      entityMatchConfidence: 0.88,
    });
  });

  it("rejects fabricated IDs", () => {
    expect(() =>
      parseEntitySelectionResult(
        {
          selectedCustomerId: "invented",
          selectedVendorId: null,
          selectedJobId: null,
          entityMatchConfidence: 0.5,
          matchEvidence: ["guess"],
        },
        context
      )
    ).toThrow(/not present in customerCandidates/);
  });

  it("forces empty selection when candidateLookupFailed", () => {
    expect(
      parseEntitySelectionResult(
        {
          selectedCustomerId: "c1",
          selectedVendorId: "v1",
          selectedJobId: "j1",
          entityMatchConfidence: 0.99,
          matchEvidence: ["should be ignored"],
        },
        { ...context, candidateLookupFailed: true }
      )
    ).toEqual({
      selectedCustomerId: null,
      selectedVendorId: null,
      selectedJobId: null,
      entityMatchConfidence: 0,
      matchEvidence: [],
    });
  });

  it("requires confidence 0 when nothing selected", () => {
    expect(() =>
      parseEntitySelectionResult(
        {
          selectedCustomerId: null,
          selectedVendorId: null,
          selectedJobId: null,
          entityMatchConfidence: 0.4,
          matchEvidence: [],
        },
        context
      )
    ).toThrow(/must be 0 when no entities are selected/);
  });
});
