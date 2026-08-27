import { describe, expect, it, vi } from "vitest";

import {
  buildSemanticSignalResponseCreateParams,
  DEFAULT_OPENAI_SEMANTIC_MODEL,
  OpenAISemanticSignalExtractor,
  SEMANTIC_SIGNAL_MAX_OUTPUT_TOKENS,
} from "../openai/semantic-signal-extractor.js";
import type { ExtractSemanticSignalsInput } from "../semantic-signals/types.js";

function sampleInput(
  overrides: Partial<ExtractSemanticSignalsInput> = {}
): ExtractSemanticSignalsInput {
  return {
    normalizedSubject: "PO #1",
    senderName: "Jane",
    senderEmail: "jane@vendor.com",
    senderDomain: "vendor.com",
    cleanBody: "Please send pricing by Friday.",
    attachmentNames: ["quote.pdf"],
    senderEvidence: { status: "LIKELY_BUSINESS" },
    domainEvidence: { status: "OBSERVED" },
    knownSender: true,
    customerCandidates: [],
    vendorCandidates: [],
    jobCandidates: [],
    approvedJobAliases: [],
    classificationInstructions: [],
    candidateLookupFailed: false,
    ...overrides,
  };
}

function validModelJson() {
  return JSON.stringify({
    contentBusinessProbability: 0.8,
    subjectBusinessProbability: 0.7,
    signatureCompanyMatchConfidence: 0,
    jobReferenceConfidence: 0.2,
    summary: "Vendor asks for pricing by Friday.",
    containsActionRequest: true,
    hasExplicitDeadline: true,
    deadlineUrgency: "STANDARD",
    signalExplanations: {
      content: "Pricing request",
      subject: "PO subject",
      signature: "No verified match",
      job: "No job match",
      deadline: "Due Friday",
    },
  });
}

describe("OpenAI Responses API semantic extractor config", () => {
  it("defaults to chat-latest and 1500 max output tokens", () => {
    expect(DEFAULT_OPENAI_SEMANTIC_MODEL).toBe("chat-latest");
    expect(SEMANTIC_SIGNAL_MAX_OUTPUT_TOKENS).toBe(1500);
  });

  it("builds Responses API params without temperature or tools", () => {
    const params = buildSemanticSignalResponseCreateParams(
      "chat-latest",
      sampleInput()
    );

    expect(params).toMatchObject({
      model: "chat-latest",
      max_output_tokens: 1500,
      text: { format: { type: "json_object" } },
    });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("tools");
    expect(params).not.toHaveProperty("tool_choice");
    expect(typeof params.instructions).toBe("string");
    expect(String(params.instructions)).toContain(
      "PRIMARY semantic signal extractor"
    );
    expect(String(params.instructions)).toMatch(/\bJSON\b/);
    expect(String(params.instructions)).toContain(
      "Return ONLY valid JSON matching the required output schema."
    );
    expect(typeof params.input).toBe("string");
    expect(String(params.input)).toContain("Subject: PO #1");
    expect(String(params.input)).toContain("--- SUPPORTING WORKSPACE EVIDENCE ---");
  });

  it("calls client.responses.create (not chat.completions) and parses output_text", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: validModelJson(),
    });
    const chatCompletionsCreate = vi.fn();

    const client = {
      responses: { create },
      chat: { completions: { create: chatCompletionsCreate } },
    } as unknown as ConstructorParameters<
      typeof OpenAISemanticSignalExtractor
    >[0];

    const extractor = new OpenAISemanticSignalExtractor(client, "chat-latest");
    const result = await extractor.extract(sampleInput());

    expect(chatCompletionsCreate).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const [request] = create.mock.calls[0]!;
    expect(request.model).toBe("chat-latest");
    expect(request.max_output_tokens).toBe(1500);
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("tools");
    expect(request.text).toEqual({ format: { type: "json_object" } });

    expect(result.containsActionRequest).toBe(true);
    expect(result.deadlineUrgency).toBe("STANDARD");
    expect(result.summary).toContain("pricing");
  });

  it("rejects empty Responses output_text", async () => {
    const client = {
      responses: {
        create: vi.fn().mockResolvedValue({ output_text: "   " }),
      },
    } as unknown as ConstructorParameters<
      typeof OpenAISemanticSignalExtractor
    >[0];

    const extractor = new OpenAISemanticSignalExtractor(client, "chat-latest");
    await expect(extractor.extract(sampleInput())).rejects.toThrow(
      /empty semantic-signal response/
    );
  });

  it("rejects invalid JSON from Responses API", async () => {
    const client = {
      responses: {
        create: vi.fn().mockResolvedValue({ output_text: "not-json" }),
      },
    } as unknown as ConstructorParameters<
      typeof OpenAISemanticSignalExtractor
    >[0];

    const extractor = new OpenAISemanticSignalExtractor(client, "chat-latest");
    await expect(extractor.extract(sampleInput())).rejects.toThrow(
      /invalid JSON/
    );
  });
});
