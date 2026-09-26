import type OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";

import { INLINE_IMAGE_VISION_MAX_BYTES, normalizeImageMimeType } from "./constants.js";
import type { InlineImageDecision } from "./deterministic.js";
import { parseInlineImageRelevanceOutput } from "./parse.js";
import {
  INLINE_IMAGE_RELEVANCE_INSTRUCTIONS,
  inlineImageRelevanceUserText,
} from "./prompt.js";

export type InlineImageVisionUsage = {
  decision: InlineImageDecision;
  inputTokens: number;
  outputTokens: number;
};

/**
 * Narrow vision call on the existing OpenAI client.
 * The request is not written to AuditEvent. Failures log only a short message.
 */
export async function classifyInlineImageWithVision(
  client: OpenAI,
  model: string,
  input: {
    mimeType: string;
    bytes: Buffer;
    width: number | null;
    height: number | null;
    sizeBytes: number;
  }
): Promise<InlineImageVisionUsage> {
  if (input.bytes.length > INLINE_IMAGE_VISION_MAX_BYTES) {
    throw new Error("image exceeds the vision size cap");
  }
  const mime = normalizeImageMimeType(input.mimeType);
  const params: ResponseCreateParamsNonStreaming = {
    model,
    instructions: INLINE_IMAGE_RELEVANCE_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: inlineImageRelevanceUserText(input) },
          {
            type: "input_image",
            image_url: `data:${mime};base64,${input.bytes.toString("base64")}`,
            detail: "low",
          },
        ],
      },
    ],
    max_output_tokens: 300,
    text: { format: { type: "json_object" } },
  };

  let outputText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const response = await client.responses.create(params);
    outputText = response.output_text?.trim() ?? "";
    const usage = response.usage;
    inputTokens = usage?.input_tokens ?? 0;
    outputTokens = usage?.output_tokens ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "vision request failed";
    console.error({
      event: "inline-image-relevance-vision-failed",
      model,
      message,
    });
    throw new Error(message);
  }

  if (!outputText) throw new Error("vision response was empty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText) as unknown;
  } catch {
    throw new Error("vision response was not JSON");
  }
  return {
    decision: parseInlineImageRelevanceOutput(parsed),
    inputTokens,
    outputTokens,
  };
}
