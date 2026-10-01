import { describe, expect, it } from "vitest";
import {
  extractProjectCandidateFromPdfFilename,
  extractProjectIdentityFromPdfFilenames,
  isGenericDocumentBasename,
} from "../bidding/extract-project-name-from-attachments.js";

describe("extractProjectCandidateFromPdfFilename", () => {
  it("extracts project from design-drawing filenames", () => {
    expect(
      extractProjectCandidateFromPdfFilename(
        "Forte - EP Office Expansion - Architectural Drawings.pdf"
      )
    ).toBe("Forte - EP Office Expansion");
    expect(
      extractProjectCandidateFromPdfFilename(
        "Garden City Elementary School - Bid Set.pdf"
      )
    ).toBe("Garden City Elementary School");
    expect(
      extractProjectCandidateFromPdfFilename(
        "Project Alpha - Structural Plans.pdf"
      )
    ).toBe("Project Alpha");
    expect(
      extractProjectCandidateFromPdfFilename(
        "North High School Addition - Construction Documents.pdf"
      )
    ).toBe("North High School Addition");
  });

  it("rejects generic document / sheet filenames", () => {
    for (const name of [
      "A101.pdf",
      "S001.pdf",
      "RFI 14.pdf",
      "ASI 03.pdf",
      "Addendum 2.pdf",
      "Proposal.pdf",
      "Quote.pdf",
      "Estimate.pdf",
      "Invoice.pdf",
      "Bid Form.pdf",
      "Instructions to Bidders.pdf",
      "Project Manual.pdf",
      "Specifications.pdf",
      "Structural Drawings.pdf",
      "Architectural Drawings.pdf",
    ]) {
      expect(extractProjectCandidateFromPdfFilename(name)).toBeNull();
    }
    expect(isGenericDocumentBasename("Structural Drawings")).toBe(true);
  });
});

describe("extractProjectIdentityFromPdfFilenames", () => {
  it("reinforces a common project across multiple PDFs", () => {
    const r = extractProjectIdentityFromPdfFilenames([
      "Forte Office Expansion - Architectural.pdf",
      "Forte Office Expansion - Structural.pdf",
      "Forte Office Expansion - Specifications.pdf",
    ]);
    expect(r.conflicting).toBe(false);
    expect(r.projectName).toBe("Forte Office Expansion");
  });

  it("marks conflicting project identities without picking one", () => {
    const r = extractProjectIdentityFromPdfFilenames([
      "Project Alpha - Architectural.pdf",
      "Project Beta - Structural.pdf",
    ]);
    expect(r.conflicting).toBe(true);
    expect(r.projectName).toBeNull();
    expect(r.candidates).toHaveLength(2);
  });
});
