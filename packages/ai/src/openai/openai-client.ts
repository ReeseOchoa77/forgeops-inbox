import OpenAI from "openai";

export interface OpenAIClientOptions {
  apiKey?: string;
  baseURL?: string;
}

export const createOpenAIClient = (
  options: OpenAIClientOptions
): OpenAI | null => {
  if (!options.apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL
  });
};

