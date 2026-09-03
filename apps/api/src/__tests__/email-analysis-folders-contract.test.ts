import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("Email Analysis discovered-folders contract", () => {
  it("list route accepts connectionId and isolates legacy NULL rows by mailbox email", () => {
    const src = readFileSync(
      join(here, "../interfaces/http/routes/folder-discovery.route.ts"),
      "utf8"
    );
    expect(src).toContain('connectionId: z.string().min(1).optional()');
    expect(src).toContain("{ inboxConnectionId: conn.id }");
    expect(src).toContain("{ inboxConnectionId: null, mailboxEmail: scopeMailboxEmail }");
    expect(src).toContain("Required database migration has not been applied");
    expect(src).toContain("serializeDiscoveredFolderRow");
  });

  it("frontend FoldersView uses case-insensitive outlook + connectionId list param", () => {
    const view = readFileSync(
      join(here, "../../../web/src/views/FoldersView.tsx"),
      "utf8"
    );
    const api = readFileSync(join(here, "../../../web/src/api.ts"), "utf8");
    expect(view).toContain("c.provider.toLowerCase() === 'outlook'");
    expect(view).toContain("connectionId: connectionIdForScope");
    expect(view).toContain("Select an Outlook mailbox");
    expect(view).not.toContain("c.provider === 'OUTLOOK'");
    expect(api).toContain("if (params?.connectionId) p.set('connectionId', params.connectionId)");
  });
});
