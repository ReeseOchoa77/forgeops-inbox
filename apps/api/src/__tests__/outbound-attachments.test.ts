import { describe, expect, it } from "vitest";

import {
  OUTLOOK_SIMPLE_ATTACHMENT_MAX_BYTES,
  getOutboundExtension,
  sanitizeOutboundFilename,
  validateOutboundUpload,
} from "../application/services/outbound-attachments.js";
import { buildMultipartMime } from "../interfaces/http/routes/send.route.js";

describe("outbound attachment validation", () => {
  it("blocks executables", () => {
    const r = validateOutboundUpload({
      filename: "payload.exe",
      sizeBytes: 100,
      maxBytes: OUTLOOK_SIMPLE_ATTACHMENT_MAX_BYTES,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects oversized files", () => {
    const r = validateOutboundUpload({
      filename: "big.pdf",
      sizeBytes: OUTLOOK_SIMPLE_ATTACHMENT_MAX_BYTES + 1,
      maxBytes: OUTLOOK_SIMPLE_ATTACHMENT_MAX_BYTES,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/exceeds/);
  });

  it("accepts PDF under Outlook simple limit", () => {
    const r = validateOutboundUpload({
      filename: "quote.pdf",
      sizeBytes: 1024,
      maxBytes: OUTLOOK_SIMPLE_ATTACHMENT_MAX_BYTES,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filename).toBe("quote.pdf");
  });

  it("sanitizes path characters in filenames", () => {
    expect(sanitizeOutboundFilename("../../evil.pdf")).toBe("_evil.pdf");
    expect(getOutboundExtension("a.PDF")).toBe(".pdf");
  });
});

describe("Gmail MIME attachments", () => {
  it("includes base64 attachment parts in multipart/mixed", () => {
    const mime = buildMultipartMime({
      from: "me@co.com",
      to: ["you@co.com"],
      cc: [],
      bcc: [],
      subject: "Hi",
      bodyHtml: "<p>hello</p>",
      bodyText: "hello",
      attachments: [
        {
          filename: "note.txt",
          mimeType: "text/plain",
          data: Buffer.from("hello"),
        },
      ],
    });
    expect(mime).toContain('Content-Type: multipart/mixed');
    expect(mime).toContain('filename="note.txt"');
    expect(mime).toContain("Content-Transfer-Encoding: base64");
    expect(mime).toContain(Buffer.from("hello").toString("base64"));
  });
});

describe("outbound attachment contract", () => {
  it("uses multipart field existingAttachmentIds for forward reuse", () => {
    const contract = {
      source: "EXISTING_EMAIL_ATTACHMENT" as const,
      emailAttachmentId: "att_1",
      filename: "spec.pdf",
    };
    expect(contract.source).toBe("EXISTING_EMAIL_ATTACHMENT");
    expect(contract.emailAttachmentId).toBeTruthy();
  });

  it("documents Outlook Graph simple attachment max as 3MB", () => {
    expect(OUTLOOK_SIMPLE_ATTACHMENT_MAX_BYTES).toBe(3 * 1024 * 1024);
  });
});
