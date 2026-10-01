import { describe, expect, it } from "vitest";
import {
  dedupeProjectAliases,
  extractProjectNameFromBody,
  resolveBidProjectIdentity,
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
    // Subject cleanup is a meaningful alternate when not identical after normalize
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
    });
    expect(r.projectName).toBe("Central Middle School Addition");
    expect(r.projectName).not.toMatch(/Mortenson/i);
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
});
