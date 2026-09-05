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
    expect(src).toContain('mode: "insensitive"');
    expect(src).toContain("Could not load discovered folders");
    expect(src).toContain("serializeDiscoveredFolderRow");
    expect(src).toContain("DISCOVERED_FOLDERS_LIST_FAILED");
    expect(src).toContain("cause: prismaErrorCause");
    expect(src).toContain('code === "P2021"');
    expect(src).toContain('code === "P2022"');
    expect(src).toContain('stage = "find_many"');
    expect(src).not.toContain('code.startsWith("P20")');
  });

  it("frontend FoldersView uses case-insensitive outlook + connectionId list param", () => {
    const view = readFileSync(
      join(here, "../../../web/src/views/FoldersView.tsx"),
      "utf8"
    );
    const api = readFileSync(join(here, "../../../web/src/api.ts"), "utf8");
    expect(view).toContain("c.provider.toLowerCase() === 'outlook'");
    expect(view).toContain("connectionId: connectionIdForScope");
    expect(view).toContain("loadSeqRef");
    expect(view).toContain("isMailboxSafeFolder");
    expect(view).toContain("eligibleVerified");
    expect(view).not.toContain("c.provider === 'OUTLOOK'");
    expect(api).toContain("if (params?.connectionId) p.set('connectionId', params.connectionId)");
  });

  it("unique DiscoveredFolder key is workspaceId+mailboxEmail+providerFolderId", () => {
    const schema = readFileSync(
      join(here, "../../../../packages/db/prisma/schema.prisma"),
      "utf8"
    );
    expect(schema).toContain("@@unique([workspaceId, mailboxEmail, providerFolderId])");
    expect(schema).toContain("inboxConnectionId       String?");
  });

  it("scan is directory-only — no message/email import APIs", () => {
    const scan = readFileSync(
      join(here, "../application/services/scan-project-folders.ts"),
      "utf8"
    );
    const folders = readFileSync(
      join(here, "../application/services/outlook-mail-folders.ts"),
      "utf8"
    );
    expect(scan).toContain("matchFolderToExistingJobs");
    expect(scan).not.toMatch(/listMailFolderMessages|emailMessage\.create|mailbox-classify|attachment-ingest/i);
    expect(folders).toContain("/mailFolders");
    expect(folders).not.toMatch(/\/messages/i);
  });

  it("scan updates matchedJobId as a scalar (never relation disconnect)", () => {
    const scan = readFileSync(
      join(here, "../application/services/scan-project-folders.ts"),
      "utf8"
    );
    expect(scan).toContain("DiscoveredFolderUncheckedUpdateInput");
    expect(scan).toContain("data.matchedJobId = match.matchedJobId");
    expect(scan).not.toMatch(/matchedJob:\s*\{[\s\S]*disconnect:\s*true/);
  });

  it("FoldersView labels Scan Project Folders separately from Analyze Emails", () => {
    const view = readFileSync(
      join(here, "../../../web/src/views/FoldersView.tsx"),
      "utf8"
    );
    expect(view).toContain("Scan Project Folders");
    expect(view).toContain("Analyze Emails (selected)");
    expect(view).toContain("Analyze Emails (all verified)");
    expect(view).toContain("Folder scan result");
    expect(view).toContain("Email analysis:");
    expect(view).not.toContain(">Analyze Project Folders<");
  });

  it("retires Job Discovery UI while keeping shared folder-discovery backend", () => {
    const app = readFileSync(join(here, "../../../web/src/App.tsx"), "utf8");
    expect(app).not.toContain("JobDiscoveryView");
    expect(app).not.toContain("label: 'Job Discovery'");
    expect(app).toContain("Legacy Job Discovery top-level page");
    expect(app).toContain("setWorkspaceTabHint('folders')");

    const route = readFileSync(
      join(here, "../interfaces/http/routes/folder-discovery.route.ts"),
      "utf8"
    );
    expect(route).toContain("/project-folders/scan");
    expect(route).toContain("/discovered-folders");
    expect(route).toContain("/job-folder-roots");
  });
});
