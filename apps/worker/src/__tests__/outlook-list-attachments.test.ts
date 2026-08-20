import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractHtmlCids,
  findMissingContentIds,
} from "@forgeops/shared";
import {
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

  it("detail GET has no $select; preserves exact inline contentId", async () => {
    const exactCid = "ii_mt1w58vg1";
    const urls: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

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
                  name: "image001.png",
                  contentType: "image/png",
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

        // Bare detail URL — no query/$select (Graph rejects contentId in $select)
        if (
          url.endsWith("/attachments/att-inline") ||
          url.includes("/attachments/att-inline?")
        ) {
          expect(url).not.toContain("$select");
          expect(url).not.toContain("contentId");
          return new Response(
            JSON.stringify({
              "@odata.type": "#microsoft.graph.fileAttachment",
              id: "att-inline",
              name: "image001.png",
              contentType: "image/png",
              isInline: true,
              contentId: exactCid,
              // contentBytes may be present on real Graph responses — schema strips it
              contentBytes: "AAAA",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (
          url.endsWith("/attachments/att-pdf") ||
          url.includes("/attachments/att-pdf?")
        ) {
          expect(url).not.toContain("$select");
          return new Response(
            JSON.stringify({
              "@odata.type": "#microsoft.graph.fileAttachment",
              id: "att-pdf",
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
    expect(inline?.mimeType).toBe("image/png");

    const pdf = result.attachments.find((a) => a.attachmentId === "att-pdf");
    expect(pdf?.filename).toBe("quote.pdf");
    expect(pdf?.contentId).toBeNull();

    const item = result.attachments.find((a) => a.attachmentId === "att-item");
    expect(item?.contentId).toBeNull();
    expect(item?.odataType).toBe("#microsoft.graph.itemAttachment");

    expect(urls.filter((u) => u.includes("/attachments?"))).toHaveLength(1);
    expect(
      urls.some((u) => u.includes("/attachments/att-inline") && !u.includes("?"))
    ).toBe(true);
    expect(urls.some((u) => u.includes("/attachments/att-item"))).toBe(false);

    expect(
      info.mock.calls.some(
        (call) =>
          call[0] === "outlook-attachment-detail" &&
          (call[1] as { contentId?: string }).contentId === exactCid
      )
    ).toBe(true);

    // CID reconciliation for the live bug HTML
    const html = `<img src="cid:${exactCid}">`;
    const htmlCids = extractHtmlCids(html);
    expect(
      findMissingContentIds(
        htmlCids,
        result.attachments.map((a) => a.contentId)
      )
    ).toEqual([]);
  });

  it("does not use invalid base-type contentId $select on detail GET", async () => {
    const urls: string[] = [];
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);

        if (url.includes("/attachments?") && !url.includes("/attachments/")) {
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: "att1",
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  name: "x.png",
                  contentType: "image/png",
                  isInline: true,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url.includes("/attachments/att1")) {
          // Simulate the old bug: if $select=contentId were present, Graph 400s
          if (url.includes("$select") && url.includes("contentId")) {
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
          return new Response(
            JSON.stringify({
              "@odata.type": "#microsoft.graph.fileAttachment",
              id: "att1",
              name: "x.png",
              contentType: "image/png",
              isInline: true,
              contentId: "ii_mt1w58vg1",
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
    expect(result.attachments[0]?.contentId).toBe("ii_mt1w58vg1");
    expect(urls.every((u) => !(u.includes("/attachments/att1") && u.includes("$select")))).toBe(
      true
    );
  });
});
