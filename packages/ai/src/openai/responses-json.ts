/**
 * Shared helpers for OpenAI Responses API JSON stages (semantic / subtype / entity / task).
 */

import type OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";

import {
  withOpenAiResponsesDiagnostics,
  type OpenAIResponsesStage,
} from "./openai-error-diagnostics.js";

export const DEFAULT_CLASSIFICATION_AI_MODEL = "chat-latest";
export const DEFAULT_CLASSIFICATION_MAX_OUTPUT_TOKENS = 1500;

export function buildJsonObjectResponseParams(input: {
  model: string;
  instructions: string;
  userInput: string;
  maxOutputTokens?: number;
}): ResponseCreateParamsNonStreaming {
  return {
    model: input.model,
    instructions: input.instructions,
    input: input.userInput,
    max_output_tokens:
      input.maxOutputTokens ?? DEFAULT_CLASSIFICATION_MAX_OUTPUT_TOKENS,
    text: { format: { type: "json_object" } },
  };
}

export async function createJsonObjectResponse(
  client: OpenAI,
  params: ResponseCreateParamsNonStreaming,
  stage: OpenAIResponsesStage
): Promise<unknown> {
  const model = typeof params.model === "string" ? params.model : String(params.model);
  return withOpenAiResponsesDiagnostics({ stage, model }, async () => {
    const response = await client.responses.create(params);
    const rawContent = response.output_text?.trim();
    if (!rawContent) {
      throw new Error("OpenAI Responses API returned an empty response");
    }
    try {
      return JSON.parse(rawContent) as unknown;
    } catch {
      throw new Error("OpenAI returned invalid JSON");
    }
  });
}

export class StructuredOutputValidationError extends Error {
  readonly issues: string[];

  constructor(label: string, issues: string[]) {
    super(
      issues.length === 1
        ? `Invalid ${label}: ${issues[0]}`
        : `Invalid ${label}: ${issues.join("; ")}`
    );
    this.name = "StructuredOutputValidationError";
    this.issues = issues;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireFiniteProbability(
  value: unknown,
  field: string,
  issues: string[]
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${field} must be a finite number`);
    return null;
  }
  if (value < 0 || value > 1) {
    issues.push(`${field} must be between 0 and 1 (got ${value})`);
    return null;
  }
  return value;
}

export function requireString(
  value: unknown,
  field: string,
  issues: string[]
): string | null {
  if (typeof value !== "string") {
    issues.push(`${field} must be a string`);
    return null;
  }
  return value;
}

export function requireNullableString(
  value: unknown,
  field: string,
  issues: string[]
): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  issues.push(`${field} must be a string or null`);
  return undefined;
}
