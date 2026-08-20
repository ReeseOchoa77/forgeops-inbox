import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OUTLOOK_ATTACHMENT_DETAIL_SELECT,
  OUTLOOK_ATTACHMENT_LIST_SELECT,
  OutlookClient,
  outlookAttachmentNeedsContentIdDetail,
} from "../infrastructure/providers/outlook/outlook-client.js";

describe("Outlook attachment Graph retrieval", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("list $select excludes contentId (base attachment only)", () => {
    expect(OUTLOOK_ATTACHMENT_LIST_SELECT).toBe(
      "id,name,contentType,size,isInline"
    );
    expect(OUTLOOK_ATTACHMENT_LIST_SELECT).not.toContain("contentId");
    expect(OUTLOOK_ATTACHMENT_DETAIL_SELECT).toContain("contentId");
  });

  it("only fileAttachment (or unknown type) needs contentId detail", () => {
    expect(
      outlookAttachmentNeedsContentIdDetail({
        id: "a1",
        "@odata.type": "#microsoft.graph.fileAttachment",
      })
    ).toBe(true);
    expect(
      outlookAttachmentNeedsContentIdDetail({
        id: "a2",
      })
    ).toBe(true);
    expect(
      outlookAttachmentNeedsContentIdDetail({
        id: "a3",
        "@odata.type": "#microsoft.graph.itemAttachment",
      })
    ).toBe(false);
    expect(
      outlookAttachmentNeedsContentIdDetail({
        id: "a4",
        "@odata.type": "#microsoft.graph.referenceAttachment",
      })
    ).toBe(false);
  });

  it("hydrates inline contentId from detail GET; list URL has no contentId", async () => {
    const exactCid = "image001.jpg@01DD28E1.71648A70";
    const urls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);

        if (url.includes("/attachments?") && !url.includes("/attachments/")) {
          expect(url).toContain(`$select=${OUTLOOK_ATTACHMENT_LIST_SELECT}`);
          expect(url).not.toMatch(/\$select=[^&]*contentId/);
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: "att-inline",
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  name: "image001.jpg",
                  contentType: "image/jpeg",
                  size: 1200,
                  isInline: true,
                },
                {
                  id: "att-pdf",
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  name: "quote.pdf",
                  contentType: "application/pdf",
                  size: 50_000,
                  isInline: false,
                },
                {
                  id: "att-item",
                  "@odata.type": "#microsoft.graph.itemAttachment",
                  name: "embedded.msg",
                  contentType: "message/rfc822",
                  size: 100,
                  isInline: false,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url.includes("/attachments/att-inline?")) {
          expect(url).toContain(`$select=${OUTLOOK_ATTACHMENT_DETAIL_SELECT}`);
          return new Response(
            JSON.stringify({
              id: "att-inline",
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: "image001.jpg",
              contentType: "image/jpeg",
              size: 1200,
              isInline: true,
              contentId: exactCid,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url.includes("/attachments/att-pdf?")) {
          return new Response(
            JSON.stringify({
              id: "att-pdf",
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: "quote.pdf",
              contentType: "application/pdf",
              size: 50_000,
              isInline: false,
              contentId: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const client = new OutlookClient({});
    const result = await client.listAttachments("token", "AAMkMsg");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.attachments).toHaveLength(3);

    const inline = result.attachments.find((a) => a.attachmentId === "att-inline");
    expect(inline?.contentId).toBe(exactCid);
    expect(inline?.inline).toBe(true);

    const pdf = result.attachments.find((a) => a.attachmentId === "att-pdf");
    expect(pdf?.filename).toBe("quote.pdf");
    expect(pdf?.contentId).toBeNull();

    const item = result.attachments.find((a) => a.attachmentId === "att-item");
    expect(item?.contentId).toBeNull();
    expect(item?.odataType).toBe("#microsoft.graph.itemAttachment");

    // List once + detail for two fileAttachments only (not itemAttachment)
    expect(urls.filter((u) => u.includes("/attachments?"))).toHaveLength(1);
    expect(urls.filter((u) => u.includes("/attachments/att-inline?"))).toHaveLength(1);
    expect(urls.filter((u) => u.includes("/attachments/att-pdf?"))).toHaveLength(1);
    expect(urls.some((u) => u.includes("/attachments/att-item?"))).toBe(false);
  });

  it("does not throw the base-type contentId OData list error shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("contentId") && url.includes("/attachments?")) {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "Could not find a property named 'contentId' on type 'microsoft.graph.attachment'",
              },
            }),
            { status: 400 }
          );
        }
        if (url.includes("/attachments?")) {
          return new Response(JSON.stringify({ value: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const client = new OutlookClient({});
    const result = await client.listAttachments("token", "AAMkMsg");
    expect(result).toEqual({ ok: true, attachments: [] });
  });
});
