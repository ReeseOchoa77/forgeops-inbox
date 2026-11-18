import type OpenAI from "openai";
import {
  emptyExtractionResult,
  type JobIntelligenceExtractionResult,
} from "@forgeops/shared";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import { buildStageValidationFailedLog } from "../openai/structured-output-diagnostics.js";
import { parseJobIntelligenceExtractionResponse } from "./parse.js";
import {
  buildJobIntelligenceUserPrompt,
  jobIntelligenceSystemPrompt,
  type JobIntelligenceEmailInput,
} from "./prompt.js";

export const DEFAULT_OPENAI_JOB_INTELLIGENCE_MODEL =
  DEFAULT_CLASSIFICATION_AI_MODEL;

export class OpenAIJobIntelligenceExtractor {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_OPENAI_JOB_INTELLIGENCE_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async extract(
    input: JobIntelligenceEmailInput
  ): Promise<JobIntelligenceExtractionResult> {
    if (!this.client) {
      return emptyExtractionResult();
    }

    const allowedEmailIds = new Set([input.emailId]);
    const allowedAttachmentIds = new Set(
      (input.attachments ?? []).map((a) => a.id)
    );

    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: jobIntelligenceSystemPrompt,
      userInput: buildJobIntelligenceUserPrompt(input),
      maxOutputTokens: 2500,
    });

    try {
      const parsed = await createJsonObjectResponse(
        this.client,
        params,
        "job_intelligence"
      );
      return parseJobIntelligenceExtractionResponse(parsed, {
        allowedEmailIds,
        allowedAttachmentIds,
      });
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        console.error(
          buildStageValidationFailedLog({
            stage: "job_intelligence",
            parsed: null,
            error,
          })
        );
      }
      return emptyExtractionResult();
    }
  }
}
