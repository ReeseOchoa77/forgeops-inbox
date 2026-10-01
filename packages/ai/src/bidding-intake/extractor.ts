import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import { buildStageValidationFailedLog } from "../openai/structured-output-diagnostics.js";
import { parseBiddingIntakeResult } from "./parse.js";
import {
  biddingIntakeSystemPrompt,
  buildBiddingIntakeUserPrompt,
  emptyBiddingIntakeResult,
  type BiddingIntakeEmailInput,
  type BiddingIntakeExtractionResult,
} from "./prompt.js";

export const DEFAULT_OPENAI_BIDDING_INTAKE_MODEL = DEFAULT_CLASSIFICATION_AI_MODEL;

export class OpenAIBiddingIntakeExtractor {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_OPENAI_BIDDING_INTAKE_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async extract(
    input: BiddingIntakeEmailInput
  ): Promise<BiddingIntakeExtractionResult> {
    if (!this.client) {
      return emptyBiddingIntakeResult();
    }

    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: biddingIntakeSystemPrompt,
      userInput: buildBiddingIntakeUserPrompt(input),
      maxOutputTokens: 400,
    });

    try {
      const parsed = await createJsonObjectResponse(
        this.client,
        params,
        "semantic"
      );
      return parseBiddingIntakeResult(parsed);
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        console.error(
          buildStageValidationFailedLog({
            stage: "semantic",
            parsed: null,
            error,
          })
        );
      }
      return emptyBiddingIntakeResult();
    }
  }
}
