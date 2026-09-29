import { describe, expect, it, vi } from "vitest";
import {
  correctInlineImageRelevance,
  InlineImageRelevanceCorrectError,
} from "../application/services/inline-image-relevance-correct.js";

function mockPrisma(overrides: {
  attachment?: Record<string, unknown> | null;
  existing?: Record<string, unknown> | null;
  upsertResult?: Record<string, unknown>;
}) {
  const attachment =
    overrides.attachment === undefined
      ? {
          id: "att1",
          workspaceId: "ws1",
          mimeType: "image/png",
          checksum: "abc123",
          uploadStatus: "UPLOADED",
        }
      : overrides.attachment;

  const existing = overrides.existing === undefined ? null : overrides.existing;

  const upsertResult =
    overrides.upsertResult ??
    ({
      emailAttachmentId: "att1",
      relevance: "NOISE",
      noiseReason: "LOGO",
      confidence: 1,
      method: "HUMAN",
      analyzerVersion: "inline-image-relevance-v1",
      evidence: "human review",
      analyzedAt: new Date("2026-09-29T12:00:00.000Z"),
      correctedAt: new Date("2026-09-29T12:00:00.000Z"),
      priorRelevance: "RELEVANT",
      priorMethod: "VISION",
    } as const);

  return {
    emailAttachment: {
      findFirst: vi.fn(async () => attachment),
      update: vi.fn(),
    },
    inlineImageRelevanceClassification: {
      findUnique: vi.fn(async () => existing),
      upsert: vi.fn(async () => upsertResult),
    },
  };
}

describe("correctInlineImageRelevance", () => {
  it("persists HUMAN correction without touching EmailAttachment", async () => {
    const prisma = mockPrisma({
      existing: {
        relevance: "NOISE",
        noiseReason: "LOGO",
        confidence: 0.91,
        method: "VISION",
        evidence: "logo layout",
        priorRelevance: null,
        priorNoiseReason: null,
        priorMethod: null,
        priorConfidence: null,
        priorEvidence: null,
      },
      upsertResult: {
        emailAttachmentId: "att1",
        relevance: "RELEVANT",
        noiseReason: null,
        confidence: 1,
        method: "HUMAN",
        analyzerVersion: "inline-image-relevance-v1",
        evidence: "human review",
        analyzedAt: new Date("2026-09-29T12:00:00.000Z"),
        correctedAt: new Date("2026-09-29T12:00:00.000Z"),
        priorRelevance: "NOISE",
        priorMethod: "VISION",
      },
    });

    const result = await correctInlineImageRelevance(prisma as never, {
      workspaceId: "ws1",
      emailAttachmentId: "att1",
      relevance: "RELEVANT",
      noiseReason: null,
      userId: "user1",
    });

    expect(result.relevance).toBe("RELEVANT");
    expect(result.method).toBe("HUMAN");
    expect(result.priorRelevance).toBe("NOISE");
    expect(prisma.emailAttachment.update).not.toHaveBeenCalled();
    expect(prisma.inlineImageRelevanceClassification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          method: "HUMAN",
          relevance: "RELEVANT",
          priorRelevance: "NOISE",
          priorMethod: "VISION",
          contentChecksum: "abc123",
        }),
        update: expect.objectContaining({
          method: "HUMAN",
          relevance: "RELEVANT",
          priorRelevance: "NOISE",
        }),
      })
    );
  });

  it("requires noiseReason when marking NOISE", async () => {
    const prisma = mockPrisma({});
    await expect(
      correctInlineImageRelevance(prisma as never, {
        workspaceId: "ws1",
        emailAttachmentId: "att1",
        relevance: "NOISE",
        userId: "user1",
      })
    ).rejects.toBeInstanceOf(InlineImageRelevanceCorrectError);
  });

  it("rejects cross-workspace attachment", async () => {
    const prisma = mockPrisma({ attachment: null });
    await expect(
      correctInlineImageRelevance(prisma as never, {
        workspaceId: "ws1",
        emailAttachmentId: "att-other",
        relevance: "RELEVANT",
        userId: "user1",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("keeps original machine prior on subsequent human flips", async () => {
    const prisma = mockPrisma({
      existing: {
        relevance: "RELEVANT",
        noiseReason: null,
        confidence: 1,
        method: "HUMAN",
        evidence: "human review",
        priorRelevance: "NOISE",
        priorNoiseReason: "LOGO",
        priorMethod: "VISION",
        priorConfidence: 0.9,
        priorEvidence: "logo",
      },
      upsertResult: {
        emailAttachmentId: "att1",
        relevance: "NOISE",
        noiseReason: "ICON",
        confidence: 1,
        method: "HUMAN",
        analyzerVersion: "inline-image-relevance-v1",
        evidence: "human review",
        analyzedAt: new Date(),
        correctedAt: new Date(),
        priorRelevance: "NOISE",
        priorMethod: "VISION",
      },
    });

    await correctInlineImageRelevance(prisma as never, {
      workspaceId: "ws1",
      emailAttachmentId: "att1",
      relevance: "NOISE",
      noiseReason: "ICON",
      userId: "user1",
    });

    expect(prisma.inlineImageRelevanceClassification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          priorRelevance: "NOISE",
          priorMethod: "VISION",
          priorNoiseReason: "LOGO",
        }),
      })
    );
  });
});

describe("job documents relevance enrichment contract", () => {
  it("batches relevance onto email images without implying deletion", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/interfaces/http/routes/jobs.route.ts"),
      "utf8"
    );
    expect(src).toContain("inlineImageRelevanceClassification.findMany");
    expect(src).toContain("imageRelevanceCounts");
    expect(src).toContain('imageRelevance: z.enum(IMAGE_RELEVANCE_FILTERS)');
    expect(src).not.toMatch(/deleteMany\(\s*\{\s*where:.*inlineImageRelevance/s);
    expect(src).not.toMatch(/EmailAttachment.*delete/);
  });
});

describe("inline image relevance correct route contract", () => {
  it("exposes HUMAN correct without altering attachment storage", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/interfaces/http/routes/inline-image-relevance.route.ts"),
      "utf8"
    );
    expect(src).toContain("/inline-image-relevance/:emailAttachmentId/correct");
    expect(src).toContain("correctInlineImageRelevance");
    expect(src).toContain('hasMinRole(membership.role, "MEMBER")');
    expect(src).toContain("isInlineImageAiAnalyzeEnabled");
    expect(src).toContain("Inline image AI analysis is paused");
  });
});
