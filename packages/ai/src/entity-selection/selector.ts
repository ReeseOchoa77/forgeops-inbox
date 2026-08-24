import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
} from "../openai/responses-json.js";
import { parseEntitySelectionResult } from "./parse.js";
import {
  buildEntitySelectionUserPrompt,
  emptyEntitySelectionResult,
  entitySelectionSystemPrompt,
  type EntitySelectionInput,
  type EntitySelectionResult,
} from "./prompt.js";

export const DEFAULT_OPENAI_ENTITY_MODEL = DEFAULT_CLASSIFICATION_AI_MODEL;

export class OpenAIEntitySelector {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_OPENAI_ENTITY_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  getModel(): string {
    return this.model;
  }

  async select(input: EntitySelectionInput): Promise<EntitySelectionResult> {
    if (input.candidateLookupFailed) {
      return emptyEntitySelectionResult();
    }

    if (!this.client) {
      throw new Error(
        "OpenAI is not configured (missing API key). Entity selection unavailable."
      );
    }

    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: entitySelectionSystemPrompt,
      userInput: buildEntitySelectionUserPrompt(input),
    });

    const parsed = await createJsonObjectResponse(this.client, params);
    return parseEntitySelectionResult(parsed, input);
  }
}
