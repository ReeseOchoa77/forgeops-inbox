import { describe, expect, it } from "vitest";
import {
  dedupeProjectAliases,
  extractProjectNameFromBody,
  isCleanerProjectRefinement,
  resolveBidProjectIdentity,
  stripCustomerFromProjectName,
} from "../bidding/resolve-bid-project-identity.js";

describe("resolveBidProjectIdentity", () => {
  it("CASE A: drawing filename beats generic reminder subject; keeps subject alternate", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: [
        "Forte - EP Office Expansion - Structural Drawings.pdf",
      ],
      subject: "Reminder to submit your Bid for Forté - EP Office Expansion",
      bodyText: "",
    });
    expect(r.projectNameSource).toBe("attachment");
    expect(r.projectName).toMatch(/EP Office Expansion/i);
    expect(
      r.alternateProjectNames.some((a) => /EP Office Expansion/i.test(a)) ||
        r.projectName?.includes("EP Office Expansion")
    ).toBe(true);
  });

  it("CASE B: A101.pdf ignored; subject wins", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: ["A101.pdf"],
      subject: "Invitation to Bid - Garden City Elementary School",
      bodyText: "",
    });
    expect(r.projectName).toBe("Garden City Elementary School");
    expect(r.projectNameSource).toBe("subject_cleanup");
  });

  it("CASE C: multiple PDFs reinforce Project Alpha", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: [
        "Project Alpha - Architectural.pdf",
        "Project Alpha - Structural.pdf",
      ],
      subject: "Bid Invitation",
      bodyText: "",
    });
    expect(r.projectName).toBe("Project Alpha");
    expect(r.projectNameSource).toBe("attachment");
  });

  it("CASE D: Addendum 2.pdf ignored", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: ["Addendum 2.pdf"],
      subject: "ITB - North High School Addition",
      bodyText: "",
    });
    expect(r.projectName).toBe("North High School Addition");
  });

  it("CASE E: Structural Drawings.pdf ignored; body Project label wins", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: ["Structural Drawings.pdf"],
      subject: "Invitation to Bid",
      bodyText: "Hello,\nProject: Central Middle School Addition\nThanks",
    });
    expect(r.projectName).toBe("Central Middle School Addition");
    expect(r.projectNameSource).toBe("body");
  });

  it("CASE F: project from PDF; customer remains separate concern", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: ["Central Middle School Addition - Bid Set.pdf"],
      subject: "Invitation from Mortenson",
      bodyText: "Mortenson invites you to bid on Central Middle School Addition",
      customerCompanyName: "Mortenson",
    });
    expect(r.projectName).toBe("Central Middle School Addition");
    expect(r.projectName).not.toMatch(/Mortenson/i);
  });

  it("CoBeck Bid Invite filename → Prieto Battery; company not in project", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: ["CoBeck Bid Invite -Prieto Battery.pdf"],
      subject: "Bid Invitation",
      bodyText:
        "CoBeck Construction invites you to submit a bid for Prieto Battery.",
      customerCompanyName: "CoBeck Construction",
    });
    expect(r.projectName).toBe("Prieto Battery");
    expect(r.projectName).not.toMatch(/CoBeck/i);
    expect(r.projectName).not.toMatch(/Bid Invite/i);
    expect(r.alternateProjectNames.join(" ")).not.toMatch(/Bid Invite/i);
  });

  it("multi-attachment Prieto Battery agreement", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: [
        "CoBeck Bid Invite - Prieto Battery.pdf",
        "Prieto Battery Structural Drawings.pdf",
        "Prieto Battery Specifications.pdf",
      ],
      subject: "ITB",
      bodyText: "CoBeck Construction invites you…",
      customerCompanyName: "CoBeck Construction",
    });
    expect(r.projectName).toBe("Prieto Battery");
  });

  it("CASE B subject: ITB - Central Middle School Addition with Mortenson files", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: [
        "Mortenson - Bid Invite - Central Middle School Addition.pdf",
        "Central Middle School - Architectural.pdf",
        "Central Middle School - Structural.pdf",
      ],
      subject: "ITB - Central Middle School Addition",
      bodyText: "",
      customerCompanyName: "Mortenson",
    });
    expect(r.projectName).toMatch(/Central Middle School Addition/i);
    expect(r.projectName).not.toMatch(/Mortenson/i);
  });

  it("CASE C: generic attachments defer to subject", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: ["A101.pdf", "S101.pdf", "Bid Form.pdf"],
      subject: "Invitation to Bid - Garden City Elementary School",
      bodyText: "",
    });
    expect(r.projectName).toBe("Garden City Elementary School");
    expect(r.projectNameSource).toBe("subject_cleanup");
  });

  it("CASE D: North Loop canonical + Apts alias; not Greiner wrapper", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: [
        "Greiner Construction ITB - North Loop Apartments.pdf",
        "North Loop Apts - Structural Set.pdf",
        "Addendum 01 - North Loop Apartments.pdf",
      ],
      subject: "Bid invite",
      bodyText: "",
      customerCompanyName: "Greiner Construction",
    });
    expect(r.projectName).toBe("North Loop Apartments");
    expect(r.alternateProjectNames).toContain("North Loop Apts");
    expect(r.alternateProjectNames.join(" ")).not.toMatch(/Greiner/i);
    expect(r.alternateProjectNames.join(" ")).not.toMatch(/\bITB\b/i);
  });

  it("conflicting PDFs fall back to subject", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: [
        "Alpha School - Bid Set.pdf",
        "Beta Campus - Bid Set.pdf",
      ],
      subject: "Invitation to Bid - Alpha School",
      bodyText: "",
    });
    expect(r.projectName).toBe("Alpha School");
    expect(r.projectNameSource).toBe("subject_cleanup");
  });

  it("conflicting PDFs: AI alone does not arbitrarily pick", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: [
        "Project Alpha - Drawings.pdf",
        "Project Beta - Drawings.pdf",
      ],
      subject: "Bid Invitation",
      bodyText: "",
      aiProjectName: "Project Alpha",
    });
    // Subject useless; conflict → null (conservative)
    expect(r.projectName).toBeNull();
  });

  it("AI may refine noisy attachment into cleaner project core", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: ["CoBeck Bid Invite -Prieto Battery.pdf"],
      subject: "Bid Invitation",
      bodyText: "",
      aiProjectName: "Prieto Battery",
      customerCompanyName: "CoBeck Construction",
    });
    expect(r.projectName).toBe("Prieto Battery");
  });

  it("body resolves weak subject + generic attachments", () => {
    const r = resolveBidProjectIdentity({
      pdfFilenames: ["Bid Form.pdf", "Specifications.pdf"],
      subject: "Invitation to Bid",
      bodyText: "Project: Harborview Medical Pavilion",
    });
    expect(r.projectName).toBe("Harborview Medical Pavilion");
    expect(r.projectNameSource).toBe("body");
  });
});

describe("stripCustomerFromProjectName / isCleanerProjectRefinement", () => {
  it("strips customer company from project", () => {
    expect(
      stripCustomerFromProjectName(
        "CoBeck Construction - Prieto Battery",
        "CoBeck Construction"
      )
    ).toBe("Prieto Battery");
  });

  it("detects cleaner AI refinement of wrapper filename", () => {
    expect(
      isCleanerProjectRefinement(
        "Prieto Battery",
        "CoBeck Bid Invite -Prieto Battery"
      )
    ).toBe(true);
  });
});

describe("extractProjectNameFromBody / dedupeProjectAliases", () => {
  it("reads labeled Project: lines only", () => {
    expect(
      extractProjectNameFromBody("Project: Central Middle School Addition")
    ).toBe("Central Middle School Addition");
    expect(extractProjectNameFromBody("Mortenson invites you")).toBeNull();
  });

  it("dedupes aliases against canonical normalize", () => {
    expect(
      dedupeProjectAliases("Forte - EP Office Expansion", [
        "FORTE - EP OFFICE EXPANSION",
        "EP Office Expansion",
        "EP Office Expansion",
        "",
      ])
    ).toEqual(["EP Office Expansion"]);
  });

  it("does not save raw document filename wrappers as aliases", () => {
    expect(
      dedupeProjectAliases("Prieto Battery", [
        "CoBeck Bid Invite - Prieto Battery",
        "Prieto Battery Project",
        "Bid Invite",
      ])
    ).toEqual(["Prieto Battery Project"]);
  });

  it("allows credible shorthand alias", () => {
    expect(
      dedupeProjectAliases("North Loop Apartments", ["North Loop Apts"])
    ).toEqual(["North Loop Apts"]);
  });
});
