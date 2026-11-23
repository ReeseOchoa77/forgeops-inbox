import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("AI Control Center API", () => {
  it("registers admin-only tenant-scoped routes", () => {
    const route = readFileSync(
      join(here, "../interfaces/http/routes/ai-control.route.ts"),
      "utf8"
    );
    const server = readFileSync(
      join(here, "../interfaces/http/server.ts"),
      "utf8"
    );
    expect(route).toContain("/api/v1/workspaces/:workspaceId/ai-control");
    expect(route).toContain('hasMinRole(membership.role, "ADMIN")');
    expect(route).toContain("confirm: z.literal(true)");
    expect(route).toContain("updateAiControlCenter");
    expect(server).toContain("registerAiControlRoutes");
  });

  it("persists config with audit and syncs Job Intelligence model", () => {
    const service = readFileSync(
      join(here, "../application/services/ai-control-center.ts"),
      "utf8"
    );
    expect(service).toContain("workspaceAiControlConfig.upsert");
    expect(service).toContain("AI_CONTROL_CENTER_UPDATED");
    expect(service).toContain("workspaceIntelligenceConfig.upsert");
    expect(service).toContain("Confirmation required");
    expect(service).toContain("Configuration version conflict");
  });

  it("enforces Job Intelligence disable at analyze start", () => {
    const ji = readFileSync(
      join(here, "../application/services/job-intelligence.ts"),
      "utf8"
    );
    expect(ji).toContain("job-intelligence");
    expect(ji).toContain("AI Control Center");
    expect(ji).toContain("statusCode: 503");
  });

  it("gates bid analysis enqueue and inline image analyze", () => {
    const bid = readFileSync(
      join(here, "../application/services/enqueue-bid-email-analyze.ts"),
      "utf8"
    );
    const inline = readFileSync(
      join(here, "../interfaces/http/routes/inline-image-relevance.route.ts"),
      "utf8"
    );
    const n8n = readFileSync(
      join(here, "../interfaces/http/routes/n8n-ingest.route.ts"),
      "utf8"
    );
    expect(bid).toContain("AI_CONTROL_DISABLED");
    expect(bid).toContain("bid-analysis");
    expect(inline).toContain("inline-image-relevance");
    expect(inline).toContain("mergeAiControlStates");
    expect(n8n).toContain("job-matcher");
    expect(n8n).toContain("autoAssignEnabled");
    expect(n8n).toContain("identityPolicy");
  });

  it("blocks reclassify when email classification is disabled", () => {
    const reclassify = readFileSync(
      join(here, "../interfaces/http/routes/mailbox-reclassify.route.ts"),
      "utf8"
    );
    expect(reclassify).toContain("email-classification");
    expect(reclassify).toContain("paused: true");
  });
});
