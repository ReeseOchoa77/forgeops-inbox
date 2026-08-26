import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
} from "../openai/responses-json.js";
import { parseBusinessSubtypeResult } from "./parse.js";
import {
  buildBusinessSubtypeUserPrompt,
  businessSubtypeSystemPrompt,
  type BusinessSubtypeEmailInput,
  type BusinessSubtypeResult,
} from "./prompt.js";

export const DEFAULT_OPENAI_SUBTYPE_MODEL = DEFAULT_CLASSIFICATION_AI_MODEL;

export class OpenAIBusinessSubtypeClassifier {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_OPENAI_SUBTYPE_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  getModel(): string {
    return this.model;
  }

  async classify(
    input: BusinessSubtypeEmailInput
  ): Promise<BusinessSubtypeResult> {
    if (!this.client) {
      throw new Error(
        "OpenAI is not configured (missing API key). Business subtype classification unavailable."
      );
    }

    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: businessSubtypeSystemPrompt,
      userInput: buildBusinessSubtypeUserPrompt(input),
    });

    const parsed = await createJsonObjectResponse(this.client, params, "subtype");
    return parseBusinessSubtypeResult(parsed);
  }
}
