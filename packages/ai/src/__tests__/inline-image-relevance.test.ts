import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
  analyzeInlineImageBatch,
  classifyInlineImageWithVision,
  deterministicInlineImageDecision,
  hashReuseDecision,
  inlineImageCandidateWhere,
  INLINE_IMAGE_RELEVANCE_INSTRUCTIONS,
  inlineImageRelevanceUserText,
  parseInlineImageRelevanceOutput,
  readImageDimensions,
  type InlineImageCandidate,
  type InlineImageRelevanceBatchDeps,
  type InlineImageRelevanceSave,
} from "../index.js";
import { StructuredOutputValidationError } from "../openai/responses-json.js";
import type OpenAI from "openai";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  bytes[2] = 0x4e;
  bytes[3] = 0x47;
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(20);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes.writeUInt16BE(11, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function candidate(overrides: Partial<InlineImageCandidate> = {}): InlineImageCandidate {
  return {
    id: "att-1",
    workspaceId: "ws-a",
    isInline: true,
    mimeType: "image/jpeg",
    sizeBytes: 80_000,
    checksum: "abc",
    storageKey: "objects/att-1",
    ...overrides,
  };
}

function deps(
  candidates: InlineImageCandidate[],
  overrides: Partial<InlineImageRelevanceBatchDeps> = {}
): {
  deps: InlineImageRelevanceBatchDeps;
  vision: ReturnType<typeof vi.fn>;
  saves: InlineImageRelevanceSave[];
  reads: string[];
} {
  const saves: InlineImageRelevanceSave[] = [];
  const reads: string[] = [];
  const vision = vi.fn(async () => ({
    decision: parseInlineImageRelevanceOutput({
      relevance: "RELEVANT",
      noiseReason: null,
      confidence: 0.86,
      evidence: "field photograph",
    }),
    inputTokens: 12,
    outputTokens: 4,
  }));
  return {
    saves,
    reads,
    vision,
    deps: {
      listCandidates: async () => candidates,
      countRemaining: async () => 3,
      findExisting: async () => null,
      findHumanHash: async () => null,
      findModelHash: async () => null,
      countRecurrence: async () => ({ messageCount: 1, threadCount: 1 }),
      readBytes: async (key) => {
        reads.push(key);
        return jpeg(800, 600);
      },
      classifyVision: vision,
      save: async (row) => {
        saves.push(row);
      },
      ...overrides,
    },
  };
}

describe("inline image candidate filter", () => {
  it("selects stored inline images and leaves regular attachments out", () => {
    const where = inlineImageCandidateWhere({ workspaceId: "ws-a", force: false });
    expect(where.isInline).toBe(true);
    expect(where.uploadStatus).toBe("UPLOADED");
    expect(where.workspaceId).toBe("ws-a");
    expect(where.mimeType.startsWith).toBe("image/");
    expect(where).not.toHaveProperty("filename");
  });
});

describe("image dimensions", () => {
  it("reads png, gif, and jpeg headers", () => {
    expect(readImageDimensions(png(1, 1))).toEqual({ width: 1, height: 1 });
    const gif = Buffer.from("GIF89a", "ascii");
    const gifBytes = Buffer.alloc(10);
    gif.copy(gifBytes);
    gifBytes.writeUInt16LE(20, 6);
    gifBytes.writeUInt16LE(20, 8);
    expect(readImageDimensions(gifBytes)).toEqual({ width: 20, height: 20 });
    expect(readImageDimensions(jpeg(800, 600))).toEqual({ width: 800, height: 600 });
  });
});

describe("deterministic signals", () => {
  it("treats a 1x1 image as a tracking pixel", () => {
    const decision = deterministicInlineImageDecision({
      mimeType: "image/png",
      sizeBytes: 200,
      width: 1,
      height: 1,
      messageCount: 1,
      threadCount: 1,
    });
    expect(decision?.relevance).toBe("NOISE");
    expect(decision?.noiseReason).toBe("TRACKING_PIXEL");
  });

  it("does not treat a merely small photo as noise", () => {
    expect(
      deterministicInlineImageDecision({
        mimeType: "image/jpeg",
        sizeBytes: 18_000,
        width: 120,
        height: 80,
        messageCount: 1,
        threadCount: 1,
      })
    ).toBeNull();
  });

  it("does not treat an unmeasured file as repeated branding", () => {
    expect(
      deterministicInlineImageDecision({
        mimeType: "image/jpeg",
        sizeBytes: 4_000,
        width: null,
        height: null,
        messageCount: 12,
        threadCount: 6,
      })
    ).toBeNull();
  });

  it("does not treat a repeated large image as noise", () => {
    expect(
      deterministicInlineImageDecision({
        mimeType: "image/jpeg",
        sizeBytes: 40_000,
        width: 800,
        height: 600,
        messageCount: 40,
        threadCount: 12,
      })
    ).toBeNull();
  });

  it("marks a small image that recurs across many threads as branding", () => {
    const decision = deterministicInlineImageDecision({
      mimeType: "image/png",
      sizeBytes: 4_000,
      width: 20,
      height: 20,
      messageCount: 10,
      threadCount: 4,
    });
    expect(decision?.relevance).toBe("NOISE");
    expect(decision?.noiseReason).toBe("REPEATED_BRANDING");
  });
});

describe("structured vision output", () => {
  it("accepts a logo noise result", () => {
    const decision = parseInlineImageRelevanceOutput({
      relevance: "NOISE",
      noiseReason: "LOGO",
      confidence: 0.91,
      evidence: "company logo",
    });
    expect(decision.relevance).toBe("NOISE");
    expect(decision.noiseReason).toBe("LOGO");
    expect(decision.method).toBe("VISION");
    expect(decision.analyzerVersion).toBe(INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION);
  });

  it("accepts a relevant result", () => {
    const decision = parseInlineImageRelevanceOutput({
      relevance: "RELEVANT",
      noiseReason: null,
      confidence: 0.84,
      evidence: "drawing screenshot",
    });
    expect(decision.relevance).toBe("RELEVANT");
    expect(decision.noiseReason).toBeNull();
  });

  it("accepts an uncertain result", () => {
    const decision = parseInlineImageRelevanceOutput({
      relevance: "UNCERTAIN",
      noiseReason: null,
      confidence: 0.4,
      evidence: "unclear graphic",
    });
    expect(decision.relevance).toBe("UNCERTAIN");
  });

  it("rejects unknown enums, extra keys, and a noise reason on a relevant image", () => {
    expect(() =>
      parseInlineImageRelevanceOutput({
        relevance: "DRAWING",
        noiseReason: null,
        confidence: 0.5,
        evidence: "x",
      })
    ).toThrow(StructuredOutputValidationError);
    expect(() =>
      parseInlineImageRelevanceOutput({
        relevance: "NOISE",
        noiseReason: "LOGO",
        confidence: 0.5,
        evidence: "company logo",
        reasoning: "hidden chain of thought",
      })
    ).toThrow(StructuredOutputValidationError);
    expect(() =>
      parseInlineImageRelevanceOutput({
        relevance: "RELEVANT",
        noiseReason: "LOGO",
        confidence: 0.5,
        evidence: "field photograph",
      })
    ).toThrow(StructuredOutputValidationError);
  });
});

describe("hash reuse", () => {
  const human = {
    workspaceId: "ws-a",
    emailAttachmentId: "att-logo",
    relevance: "NOISE" as const,
    noiseReason: "LOGO" as const,
    confidence: 1,
    method: "HUMAN" as const,
    evidence: "sender acme logo",
  };

  it("copies a human-confirmed exact match inside the workspace", () => {
    const decision = hashReuseDecision({ workspaceId: "ws-a", human, model: null });
    expect(decision?.method).toBe("HUMAN_CONFIRMED_HASH_MATCH");
    expect(decision?.relevance).toBe("NOISE");
    expect(decision?.evidence).not.toContain("acme");
    expect(decision?.sourceAttachmentId).toBe("att-logo");
  });

  it("does not copy another workspace, an uncertain result, or a low-confidence model result", () => {
    expect(
      hashReuseDecision({
        workspaceId: "ws-b",
        human,
        model: null,
      })
    ).toBeNull();
    expect(
      hashReuseDecision({
        workspaceId: "ws-a",
        human: { ...human, relevance: "UNCERTAIN", noiseReason: null },
        model: null,
      })
    ).toBeNull();
    expect(
      hashReuseDecision({
        workspaceId: "ws-a",
        human: null,
        model: {
          ...human,
          method: "VISION",
          confidence: 0.79,
          evidence: "company logo",
        },
      })
    ).toBeNull();
    const model = hashReuseDecision({
      workspaceId: "ws-a",
      human: null,
      model: {
        ...human,
        method: "VISION",
        confidence: 0.8,
        evidence: "company logo",
      },
    });
    expect(model?.method).toBe("MODEL_HASH_MATCH");
  });
});

describe("analyze inline image batch", () => {
  it("skips a regular attachment and classifies the inline image", async () => {
    const harness = deps([
      candidate({ id: "file", isInline: false, mimeType: "application/pdf" }),
      candidate({ id: "photo" }),
    ]);
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(harness.saves.map((row) => row.emailAttachmentId)).toEqual(["photo"]);
    expect(result.vision).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("classifies a 1x1 png as noise without calling vision", async () => {
    const harness = deps([candidate({ mimeType: "image/png", sizeBytes: 180 })], {
      readBytes: async () => png(1, 1),
    });
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.noise).toBe(1);
    expect(result.deterministic).toBe(1);
    expect(harness.vision).not.toHaveBeenCalled();
    expect(harness.saves[0]?.decision.noiseReason).toBe("TRACKING_PIXEL");
  });

  it("sends a large image to vision", async () => {
    const harness = deps([candidate()]);
    await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(harness.vision).toHaveBeenCalledOnce();
    expect(harness.saves[0]?.decision.relevance).toBe("RELEVANT");
    expect(harness.saves[0]?.decision.evidence).toBe("field photograph");
  });

  it("keeps an unsupported image uncertain and continues", async () => {
    const harness = deps([
      candidate({ id: "svg", mimeType: "image/svg+xml", sizeBytes: 500 }),
      candidate({ id: "photo" }),
    ]);
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.unsupported).toBe(1);
    expect(result.uncertain).toBe(1);
    expect(result.vision).toBe(1);
    expect(harness.saves[0]?.decision.relevance).toBe("UNCERTAIN");
    expect(harness.saves[1]?.emailAttachmentId).toBe("photo");
  });

  it("continues after one image fails", async () => {
    const harness = deps([
      candidate({ id: "bad", storageKey: "bad" }),
      candidate({ id: "good", storageKey: "good" }),
    ], {
      readBytes: async (key) => {
        if (key === "bad") throw new Error("corrupt");
        return jpeg(640, 480);
      },
    });
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.failed).toBe(1);
    expect(result.vision).toBe(1);
    expect(harness.saves.map((row) => row.emailAttachmentId)).toEqual(["good"]);
  });

  it("reuses an existing result and does not call vision again", async () => {
    const harness = deps([candidate()], {
      findExisting: async () => ({
        emailAttachmentId: "att-1",
        workspaceId: "ws-a",
        relevance: "RELEVANT",
        noiseReason: null,
        confidence: 0.9,
        method: "VISION",
        evidence: "field photograph",
        contentChecksum: "abc",
      }),
    });
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.reused).toBe(1);
    expect(result.analyzed).toBe(0);
    expect(harness.vision).not.toHaveBeenCalled();
    expect(harness.saves).toHaveLength(0);
  });

  it("reanalyzes a model result when force is set", async () => {
    const harness = deps([candidate()], {
      findExisting: async () => ({
        emailAttachmentId: "att-1",
        workspaceId: "ws-a",
        relevance: "NOISE",
        noiseReason: "LOGO",
        confidence: 0.9,
        method: "VISION",
        evidence: "company logo",
        contentChecksum: "abc",
      }),
    });
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: true,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.vision).toBe(1);
    expect(result.reused).toBe(0);
  });

  it("keeps a human decision when force is set", async () => {
    const harness = deps([candidate()], {
      findExisting: async () => ({
        emailAttachmentId: "att-1",
        workspaceId: "ws-a",
        relevance: "RELEVANT",
        noiseReason: null,
        confidence: 1,
        method: "HUMAN",
        evidence: "kept drawing",
        contentChecksum: "abc",
      }),
    });
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: true,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.reused).toBe(1);
    expect(result.vision).toBe(0);
    expect(harness.saves).toHaveLength(0);
  });

  it("lets a human hash win over a tracking-pixel measurement", async () => {
    const harness = deps([candidate({ mimeType: "image/png", sizeBytes: 180, checksum: "pixel" })], {
      readBytes: async () => png(1, 1),
      findHumanHash: async () => ({
        workspaceId: "ws-a",
        emailAttachmentId: "att-human",
        relevance: "RELEVANT",
        noiseReason: null,
        confidence: 1,
        method: "HUMAN",
        evidence: "marked useful",
      }),
    });
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.hashHuman).toBe(1);
    expect(result.noise).toBe(0);
    expect(harness.vision).not.toHaveBeenCalled();
    expect(harness.reads).toHaveLength(0);
    expect(harness.saves[0]?.decision.relevance).toBe("RELEVANT");
  });

  it("lets a confident model hash win over repeated-branding", async () => {
    const harness = deps([candidate({ mimeType: "image/png", sizeBytes: 4_000, checksum: "mark" })], {
      readBytes: async () => png(32, 32),
      countRecurrence: async () => ({ messageCount: 20, threadCount: 8 }),
      findModelHash: async () => ({
        workspaceId: "ws-a",
        emailAttachmentId: "att-vision",
        relevance: "RELEVANT",
        noiseReason: null,
        confidence: 0.9,
        method: "VISION",
        evidence: "detail crop",
      }),
    });
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.hashModel).toBe(1);
    expect(result.noise).toBe(0);
    expect(harness.vision).not.toHaveBeenCalled();
    expect(harness.saves[0]?.decision.relevance).toBe("RELEVANT");
  });

  it("hashes bytes when the attachment checksum is empty and reuses that hash", async () => {
    const bytes = jpeg(640, 480);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const harness = deps([candidate({ checksum: null, storageKey: "objects/plain" })], {
      readBytes: async () => bytes,
      findHumanHash: async ({ checksum: value }) => {
        if (value !== checksum) return null;
        return {
          workspaceId: "ws-a",
          emailAttachmentId: "att-logo",
          relevance: "NOISE",
          noiseReason: "LOGO",
          confidence: 1,
          method: "HUMAN",
          evidence: "secret sender",
        };
      },
    });
    const result = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(result.hashHuman).toBe(1);
    expect(harness.vision).not.toHaveBeenCalled();
    expect(harness.saves[0]?.contentChecksum).toBe(checksum);
    expect(harness.saves[0]?.decision.evidence).not.toContain("secret");
  });

  it("reuses a same-workspace human hash and ignores another workspace", async () => {
    const calls: string[] = [];
    const harness = deps([candidate({ checksum: "logo-hash" })], {
      findHumanHash: async ({ workspaceId }) => {
        calls.push(workspaceId);
        return {
          workspaceId: "ws-b",
          emailAttachmentId: "foreign",
          relevance: "NOISE",
          noiseReason: "LOGO",
          confidence: 1,
          method: "HUMAN",
          evidence: "secret sender",
        };
      },
    });
    const isolated = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(calls).toEqual(["ws-a"]);
    expect(isolated.vision).toBe(1);
    expect(harness.saves[0]?.decision.method).toBe("VISION");

    const matched = deps([candidate({ checksum: "logo-hash" })], {
      findHumanHash: async () => ({
        workspaceId: "ws-a",
        emailAttachmentId: "att-logo",
        relevance: "NOISE",
        noiseReason: "LOGO",
        confidence: 1,
        method: "HUMAN",
        evidence: "secret sender",
      }),
    });
    const reused = await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: matched.deps,
    });
    expect(reused.hashHuman).toBe(1);
    expect(matched.vision).not.toHaveBeenCalled();
    expect(matched.saves[0]?.decision.evidence).not.toContain("secret");
  });

  it("does not write attachment fields", async () => {
    const frozen = Object.freeze(candidate());
    const harness = deps([frozen]);
    await analyzeInlineImageBatch({
      workspaceId: "ws-a",
      force: false,
      limit: 25,
      deps: harness.deps,
    });
    expect(frozen).toEqual(candidate());
    expect(Object.keys(harness.saves[0] ?? {})).toEqual([
      "workspaceId",
      "emailAttachmentId",
      "decision",
      "contentChecksum",
      "inputTokens",
      "outputTokens",
    ]);
  });
});

describe("vision request", () => {
  it("sends a low-detail image and parses usage without a filename", async () => {
    let body = "";
    const client = {
      responses: {
        create: async (params: { input: unknown }) => {
          body = JSON.stringify(params.input);
          return {
            output_text: JSON.stringify({
              relevance: "UNCERTAIN",
              noiseReason: null,
              confidence: 0.42,
              evidence: "unclear graphic",
            }),
            usage: { input_tokens: 30, output_tokens: 8 },
          };
        },
      },
    };
    const result = await classifyInlineImageWithVision(client as unknown as OpenAI, "gpt-4o-mini", {
      mimeType: "image/jpeg",
      bytes: jpeg(320, 240),
      width: 320,
      height: 240,
      sizeBytes: 4000,
    });
    expect(result.decision.relevance).toBe("UNCERTAIN");
    expect(result.inputTokens).toBe(30);
    expect(body).toContain("data:image/jpeg;base64,");
    expect(body).toContain("low");
    expect(body).not.toContain("image001");
    expect(body).not.toContain("filename");
  });

  it("rejects invalid model output", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({ relevance: "MAYBE" }),
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };
    await expect(
      classifyInlineImageWithVision(client as unknown as OpenAI, "gpt-4o-mini", {
        mimeType: "image/png",
        bytes: png(32, 32),
        width: 32,
        height: 32,
        sizeBytes: 100,
      })
    ).rejects.toBeInstanceOf(StructuredOutputValidationError);
  });
});

describe("vision prompt", () => {
  it("biases toward relevant and asks for JSON", () => {
    const text = inlineImageRelevanceUserText({
      mimeType: "image/png",
      sizeBytes: 1000,
      width: null,
      height: null,
    });
    expect(text.toLowerCase()).toContain("json");
    expect(text).toContain("not automatically noise");
    expect(INLINE_IMAGE_RELEVANCE_INSTRUCTIONS).toContain("relevance must be RELEVANT");
  });
});
