import type OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";

import {
  buildSemanticSignalUserPrompt,
  semanticSignalSystemPrompt,
} from "../semantic-signals/prompt.js";
import {
  parseSemanticSignals,
  type ExtractSemanticSignalsInput,
  type SemanticSignals,
} from "../semantic-signals/types.js";

export type { ExtractSemanticSignalsInput };

/** Default model for n8n Classify Email With Candidates parity. */
export const DEFAULT_OPENAI_SEMANTIC_MODEL = "chat-latest";

/** Matches current production n8n max output tokens. */
export const SEMANTIC_SIGNAL_MAX_OUTPUT_TOKENS = 1500;

/**
 * Build the OpenAI Responses API request for semantic extraction.
 * Intentionally omits `temperature` and `tools` so provider defaults match n8n.
 */
export function buildSemanticSignalResponseCreateParams(
  model: string,
  input: ExtractSemanticSignalsInput
): ResponseCreateParamsNonStreaming {
  return {
    model,
    instructions: semanticSignalSystemPrompt,
    input: buildSemanticSignalUserPrompt(input),
    max_output_tokens: SEMANTIC_SIGNAL_MAX_OUTPUT_TOKENS,
    // Encourage JSON object output; strict parseSemanticSignals still validates.
    text: {
      format: { type: "json_object" },
    },
  };
}

export class OpenAISemanticSignalExtractor {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_OPENAI_SEMANTIC_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  getModel(): string {
    return this.model;
  }

  async extract(input: ExtractSemanticSignalsInput): Promise<SemanticSignals> {
    if (!this.client) {
      throw new Error(
        "OpenAI is not configured (missing API key). Semantic signal extraction unavailable."
      );
    }

    const params = buildSemanticSignalResponseCreateParams(this.model, input);
    const response = await this.client.responses.create(params);

    const rawContent = response.output_text?.trim();
    if (!rawContent) {
      throw new Error("OpenAI Responses API returned an empty semantic-signal response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      throw new Error("OpenAI returned invalid JSON for semantic signals");
    }

    return parseSemanticSignals(parsed);
  }
}
