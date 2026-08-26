import OpenAI from "openai";

export interface OpenAIClientOptions {
  apiKey?: string;
  baseURL?: string;
}

/**
 * Normalize an OpenAI API key from env/config.
 * Trims whitespace/newlines; empty-after-trim means unconfigured.
 */
export function normalizeOpenAiApiKey(
  apiKey: string | null | undefined
): string | undefined {
  if (apiKey == null) return undefined;
  const trimmed = apiKey.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const createOpenAIClient = (
  options: OpenAIClientOptions
): OpenAI | null => {
  const apiKey = normalizeOpenAiApiKey(options.apiKey);
  if (!apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });
};
