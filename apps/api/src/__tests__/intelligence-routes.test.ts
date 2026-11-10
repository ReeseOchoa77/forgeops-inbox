import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { listIntelligenceSafeDtos } from "@forgeops/shared";
import { registerIntelligenceRoutes } from "../interfaces/http/routes/intelligence.route.js";
import { inspectIntelligenceInstructions } from "../application/services/intelligence-prompt-inspection.js";

const here = dirname(fileURLToPath(import.meta.url));

vi.mock("../interfaces/http/authentication.js", () => ({
  getSessionFromRequest: vi.fn(async () => null),
}));

vi.mock("../application/services/workspace-access.js", () => ({
  requireWorkspaceMembership: vi.fn(async () => null),
}));

describe("intelligence route registration", () => {
  it("registers discovery + job-matcher eval/test paths", async () => {
    const app = Fastify();
    app.decorate("services", { prisma: {} } as never);
    await registerIntelligenceRoutes(app);
    await app.ready();
    const printed = app.printRoutes().replace(/\s+/g, " ");
    expect(printed).toContain("/intelligence");
    expect(printed).toContain("uate (POST)"); // Fastify tree-splits "evaluate"
    expect(printed).toContain("-dataset-preview (POST)");
    expect(printed).toContain("mails/");
    expect(printed).toContain("one (POST)");
    expect(printed).toContain("job-matcher");
    await app.close();
  });

  it("server.ts registers intelligence routes", () => {
    const src = readFileSync(
      join(here, "../interfaces/http/server.ts"),
      "utf8"
    );
    expect(src).toContain("registerIntelligenceRoutes");
  });
});

describe("intelligence authorization", () => {
  it("rejects unauthenticated list requests", async () => {
    const { getSessionFromRequest } = await import(
      "../interfaces/http/authentication.js"
    );
    vi.mocked(getSessionFromRequest).mockResolvedValueOnce(null);

    const app = Fastify();
    app.decorate("services", { prisma: {} } as never);
    await registerIntelligenceRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws_1/intelligence",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects MEMBER role for intelligence APIs", async () => {
    const { getSessionFromRequest } = await import(
      "../interfaces/http/authentication.js"
    );
    const { requireWorkspaceMembership } = await import(
      "../application/services/workspace-access.js"
    );
    vi.mocked(getSessionFromRequest).mockResolvedValueOnce({
      userId: "u1",
    } as never);
    vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
      role: "MEMBER",
    } as never);

    const app = Fastify();
    app.decorate("services", { prisma: {} } as never);
    await registerIntelligenceRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws_1/intelligence",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/Admin/i);
    await app.close();
  });

  it("ADMIN can list safe DTOs from registry", async () => {
    const { getSessionFromRequest } = await import(
      "../interfaces/http/authentication.js"
    );
    const { requireWorkspaceMembership } = await import(
      "../application/services/workspace-access.js"
    );
    vi.mocked(getSessionFromRequest).mockResolvedValueOnce({
      userId: "u1",
    } as never);
    vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
      role: "ADMIN",
    } as never);

    const app = Fastify();
    app.decorate("services", { prisma: {} } as never);
    await registerIntelligenceRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws_1/intelligence",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { components: Array<{ id: string }> };
    expect(body.components.length).toBeGreaterThan(0);
    expect(body.components.map((c) => c.id)).toEqual(
      listIntelligenceSafeDtos({ discoverableOnly: true }).map((c) => c.id)
    );
    await app.close();
  });

  it("unknown intelligence id returns 404", async () => {
    const { getSessionFromRequest } = await import(
      "../interfaces/http/authentication.js"
    );
    const { requireWorkspaceMembership } = await import(
      "../application/services/workspace-access.js"
    );
    vi.mocked(getSessionFromRequest).mockResolvedValueOnce({
      userId: "u1",
    } as never);
    vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
      role: "OWNER",
    } as never);

    const app = Fastify();
    app.decorate("services", { prisma: {} } as never);
    await registerIntelligenceRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/workspaces/ws_1/intelligence/not-a-real-system",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("eval-dataset-preview and email inspector paths are registered", async () => {
    const app = Fastify();
    app.decorate("services", { prisma: {} } as never);
    await registerIntelligenceRoutes(app);
    await app.ready();
    const printed = app.printRoutes().replace(/\s+/g, " ");
    expect(printed).toContain("-dataset-preview (POST)");
    expect(printed).toContain("mails/");
    expect(printed).toContain(":emailMessageId");
    await app.close();
  });

  it("evaluation endpoint requires admin", async () => {
    const { getSessionFromRequest } = await import(
      "../interfaces/http/authentication.js"
    );
    const { requireWorkspaceMembership } = await import(
      "../application/services/workspace-access.js"
    );
    vi.mocked(getSessionFromRequest).mockResolvedValueOnce({
      userId: "u1",
    } as never);
    vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
      role: "MEMBER",
    } as never);

    const app = Fastify();
    app.decorate("services", { prisma: {} } as never);
    await registerIntelligenceRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces/ws_1/intelligence/job-matcher/evaluate",
      payload: { limit: 50 },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe("intelligence safe DTO + prompt inspection", () => {
  it("list DTOs never include secret-like keys", () => {
    const json = JSON.stringify(listIntelligenceSafeDtos());
    expect(json).not.toMatch(/\bapi[_-]?key\b/i);
    expect(json).not.toMatch(/\bsk-[a-zA-Z0-9]{10,}/);
    expect(json).not.toMatch(/\bOPENAI_API_KEY\b/);
  });

  it("prompt inspection resolves live modules without duplicating secrets", () => {
    const rows = inspectIntelligenceInstructions([
      "semanticSignalSystemPrompt",
      "missing-key",
    ]);
    expect(rows[0]?.available).toBe(true);
    expect(rows[0]?.text && rows[0].text.length).toBeGreaterThan(20);
    expect(rows[1]?.available).toBe(false);
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/\bsk-[a-zA-Z0-9]{10,}/);
  });
});

describe("evaluation mutation safety (source contract)", () => {
  it("historical eval uses evaluation eligibility and declares no DB writes", () => {
    const src = readFileSync(
      join(here, "../application/services/run-job-matcher-historical-eval.ts"),
      "utf8"
    );
    expect(src).toContain('eligibilityMode: "evaluation"');
    expect(src).toContain('databaseWrites: "NONE"');
    expect(src).toContain("target leakage");
    expect(src).not.toContain("persistJobMatch");
    expect(src).not.toContain("emailMessage.update");
    // Selected Job must not be passed as matcher target hint.
    expect(src).not.toContain("expectedJobId");
    expect(src).not.toContain("targetJobId");
    const matchStart = src.indexOf("const result = await matcher.match({");
    const matchCall = src.slice(matchStart, src.indexOf("});", matchStart) + 3);
    expect(matchCall).toContain("eligibilityMode");
    expect(matchCall).not.toContain("trueJobId");
    expect(matchCall).not.toContain("jobIds:");
  });

  it("test-one is workspace scoped and read-only", () => {
    const src = readFileSync(
      join(here, "../application/services/run-job-matcher-test-one.ts"),
      "utf8"
    );
    expect(src).toContain("workspaceId: input.workspaceId");
    expect(src).toContain('eligibilityMode: "evaluation"');
    expect(src).toContain('databaseWrites: "NONE"');
    expect(src).not.toContain("persistJobMatch");
  });

  it("email inspector loads by workspace + id (no cross-workspace)", () => {
    const src = readFileSync(
      join(here, "../application/services/load-intelligence-eval-email.ts"),
      "utf8"
    );
    expect(src).toContain("workspaceId: input.workspaceId");
    expect(src).toContain("id: input.emailMessageId");
  });
});
