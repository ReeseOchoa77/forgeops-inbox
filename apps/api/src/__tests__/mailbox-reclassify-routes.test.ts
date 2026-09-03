import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { registerMailboxReclassifyRoutes } from "../interfaces/http/routes/mailbox-reclassify.route.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Canonical mailbox reclassify HTTP contract (frontend api.ts must match). */
export const MAILBOX_RECLASSIFY_ROUTE_CONTRACT = [
  "GET /api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/meta",
  "GET /api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/senders",
  "POST /api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/preview",
  "POST /api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/runs",
  "GET /api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/runs/:runId",
  "POST /api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/reclassify/runs/:runId/cancel",
] as const;

describe("mailbox reclassify route registration", () => {
  it("registers every canonical reclassify path on Fastify", async () => {
    const app = Fastify();
    app.decorate(
      "services",
      {
        prisma: {},
        mailboxReclassifyQueue: { add: async () => ({}) },
      } as never
    );
    registerMailboxReclassifyRoutes(app);
    await app.ready();

    const printed = app.printRoutes();
    expect(printed).toContain("/reclassify/");
    expect(printed).toContain("meta (GET");
    expect(printed).toContain("senders (GET");
    expect(printed).toContain("preview (POST)");
    expect(printed).toContain("runs (POST)");
    expect(printed).toContain("cancel (POST)");
    await app.close();
  });

  it("server.ts registers mailbox reclassify routes", () => {
    const src = readFileSync(
      join(here, "../interfaces/http/server.ts"),
      "utf8"
    );
    expect(src).toContain("registerMailboxReclassifyRoutes");
    expect(src).toContain("mailbox_reclassify_routes_registered");
  });
});

describe("mailbox reclassify frontend path contract", () => {
  it("web api.ts uses the same canonical paths", () => {
    const src = readFileSync(
      join(here, "../../../web/src/api.ts"),
      "utf8"
    );
    expect(src).toContain(
      "/inbox-connections/${connectionId}/reclassify/meta"
    );
    expect(src).toContain("/reclassify/senders?");
    expect(src).toContain("/reclassify/preview");
    expect(src).toContain("/reclassify/runs");
    expect(src).toContain("/reclassify/runs/${runId}/cancel");
  });

  it("MonitoredMailboxesPanel only exposes Reclassify Emails", () => {
    const panel = readFileSync(
      join(here, "../../../web/src/components/MonitoredMailboxesPanel.tsx"),
      "utf8"
    );
    expect(panel).toContain("Reclassify Emails");
    expect(panel).toContain("ReclassifyEmailsModal");
    expect(panel).not.toContain("Classify Unclassified Emails");
    expect(panel).not.toContain("Reclassify Unclassified Emails");
  });

  it("documents the full route matrix", () => {
    expect(MAILBOX_RECLASSIFY_ROUTE_CONTRACT).toHaveLength(6);
    expect(MAILBOX_RECLASSIFY_ROUTE_CONTRACT[0]).toContain("reclassify/meta");
  });
});
