import { describe, expect, it } from "vitest";
import {
  extractProjectCandidateFromPdfFilename,
  extractProjectFromCompoundFilename,
  extractProjectIdentityFromPdfFilenames,
  isGenericDocumentBasename,
  looksLikeDocumentWrapperTitle,
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

  it("strips Bid Invite wrapper and company prefix: CoBeck → Prieto Battery", () => {
    expect(
      extractProjectCandidateFromPdfFilename(
        "CoBeck Bid Invite -Prieto Battery.pdf"
      )
    ).toBe("Prieto Battery");
    expect(
      extractProjectCandidateFromPdfFilename(
        "CoBeck Bid Invite - Prieto Battery.pdf",
        "CoBeck Construction"
      )
    ).toBe("Prieto Battery");
  });

  it("strips company + Bid Invite segment: Mortenson case", () => {
    expect(
      extractProjectCandidateFromPdfFilename(
        "Mortenson - Bid Invite - Central Middle School Addition.pdf"
      )
    ).toBe("Central Middle School Addition");
  });

  it("strips Greiner Construction ITB wrapper", () => {
    expect(
      extractProjectCandidateFromPdfFilename(
        "Greiner Construction ITB - North Loop Apartments.pdf"
      )
    ).toBe("North Loop Apartments");
  });

  it("strips trailing Structural Drawings without requiring a dash", () => {
    expect(
      extractProjectCandidateFromPdfFilename(
        "Prieto Battery Structural Drawings.pdf"
      )
    ).toBe("Prieto Battery");
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
    expect(looksLikeDocumentWrapperTitle("Bid Invite")).toBe(true);
  });

  it("does not hard-code CoBeck — unknown company prefix still stripped via wrapper structure", () => {
    expect(
      extractProjectCandidateFromPdfFilename(
        "ZebraFab Bid Invitation - Riverside Clinic.pdf"
      )
    ).toBe("Riverside Clinic");
  });
});

describe("extractProjectFromCompoundFilename", () => {
  it("returns company hint without putting it in projectName", () => {
    const r = extractProjectFromCompoundFilename(
      "CoBeck Bid Invite - Prieto Battery"
    );
    expect(r.projectName).toBe("Prieto Battery");
    expect(r.ambiguous).toBe(false);
    expect(r.companyHint).toMatch(/CoBeck/i);
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

  it("CASE A: semantic agreement across CoBeck + Prieto Battery files", () => {
    const r = extractProjectIdentityFromPdfFilenames([
      "CoBeck Bid Invite - Prieto Battery.pdf",
      "Prieto Battery Structural Drawings.pdf",
      "Prieto Battery Specifications.pdf",
    ]);
    expect(r.conflicting).toBe(false);
    expect(r.projectName).toBe("Prieto Battery");
  });

  it("CASE B: Mortenson invite + Central Middle School drawings", () => {
    const r = extractProjectIdentityFromPdfFilenames(
      [
        "Mortenson - Bid Invite - Central Middle School Addition.pdf",
        "Central Middle School - Architectural.pdf",
        "Central Middle School - Structural.pdf",
      ],
      "Mortenson"
    );
    expect(r.conflicting).toBe(false);
    expect(r.projectName).toMatch(/Central Middle School/i);
    expect(r.projectName).not.toMatch(/Mortenson/i);
  });

  it("CASE D: North Loop Apartments + Apts abbreviation agree", () => {
    const r = extractProjectIdentityFromPdfFilenames([
      "Greiner Construction ITB - North Loop Apartments.pdf",
      "North Loop Apts - Structural Set.pdf",
      "Addendum 01 - North Loop Apartments.pdf",
    ]);
    expect(r.conflicting).toBe(false);
    expect(r.projectName).toBe("North Loop Apartments");
    expect(r.candidates.some((c) => /Apts/i.test(c))).toBe(true);
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
