import { describe, expect, it } from "vitest";

/**
 * Structural contract: Outlook client must expose Sent Items as a first-class
 * well-known folder separate from Inbox (independent delta URLs).
 */
describe("Outlook mailFolders/sentitems delta contract", () => {
  it("source targets inbox and sentitems independently", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "../infrastructure/providers/outlook/outlook-client.ts"),
      "utf8"
    );
    expect(src).toContain('mailFolder === "sentitems"');
    expect(src).toContain("mailFolders/sentitems");
    expect(src).toContain("mailFolders/inbox");
    expect(src).toContain("messages/delta");
    expect(src).toContain('direction: "RECEIVED" | "SENT"');
    expect(src).toContain('mailFolder === "sentitems" ? "SENT" : "RECEIVED"');
  });

  it("live sync processor gates Sent Items on listenSent", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "../application/processors/inbox-sync.processor.ts"),
      "utf8"
    );
    expect(src).toContain("listenSent === true");
    expect(src).toContain('mailFolder: "sentitems"');
    expect(src).toContain('mailFolder: "inbox"');
    expect(src).toContain("sentSyncCursor");
    expect(src).toContain("mergeInboxSyncImports");
  });
});
