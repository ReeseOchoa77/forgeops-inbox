import { describe, expect, it } from "vitest";
import {
  extractHtmlCids,
  findMissingContentIds,
  normalizeContentId,
  shouldInspectAttachments,
} from "../attachments/cid.js";

describe("shouldInspectAttachments", () => {
  it("is true when provider hasAttachments is true", () => {
    expect(shouldInspectAttachments({ hasAttachments: true, bodyHtml: null })).toBe(true);
  });

  it("is true for inline-only HTML when hasAttachments is false", () => {
    const html = `<html><body><img src="cid:image001.jpg@01DD28E1.71648A70"></body></html>`;
    expect(shouldInspectAttachments({ hasAttachments: false, bodyHtml: html })).toBe(true);
  });

  it("is true for quoted-printable cid src", () => {
    const html = `<img src=3D"cid:logo@example.com">`;
    expect(shouldInspectAttachments({ hasAttachments: false, bodyHtml: html })).toBe(true);
  });

  it("is false when neither flag nor cid present", () => {
    expect(
      shouldInspectAttachments({
        hasAttachments: false,
        bodyHtml: "<p>No images</p>",
      })
    ).toBe(false);
  });
});

describe("extractHtmlCids / reconciliation", () => {
  it("extracts multiple cid references including non-jpg types", () => {
    const html = `
      <img src="cid:image001.jpg@01DD28E1.71648A70">
      <img src='cid:sig.png@abc'>
      <div style="background:url(cid:banner.gif@xyz)"></div>
    `;
    const cids = extractHtmlCids(html);
    expect(cids).toContain(normalizeContentId("image001.jpg@01DD28E1.71648A70"));
    expect(cids).toContain(normalizeContentId("sig.png@abc"));
    expect(cids).toContain(normalizeContentId("banner.gif@xyz"));
  });

  it("finds missing CIDs when Graph listing omits one", () => {
    const htmlCids = extractHtmlCids(
      `<img src="cid:image001.jpg@01DD28E1.71648A70"><img src="cid:missing@cid">`
    );
    const missing = findMissingContentIds(htmlCids, [
      "<image001.jpg@01DD28E1.71648A70>",
    ]);
    expect(missing).toEqual([normalizeContentId("missing@cid")]);
  });

  it("matches Outlook local-part CIDs", () => {
    const htmlCids = extractHtmlCids(`<img src="cid:image001.jpg@01DD28E1.71648A70">`);
    const missing = findMissingContentIds(htmlCids, ["image001.jpg"]);
    expect(missing).toEqual([]);
  });
});
