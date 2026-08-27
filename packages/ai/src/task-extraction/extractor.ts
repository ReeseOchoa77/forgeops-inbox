import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import { buildStageValidationFailedLog } from "../openai/structured-output-diagnostics.js";
import { parseTaskExtractionResult } from "./parse.js";
import {
  buildTaskExtractionUserPrompt,
  emptyTaskExtractionResult,
  taskExtractionSystemPrompt,
  type TaskExtractionEmailInput,
  type TaskExtractionResult,
} from "./prompt.js";

export const DEFAULT_OPENAI_TASK_MODEL = DEFAULT_CLASSIFICATION_AI_MODEL;

export class OpenAITaskExtractor {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_OPENAI_TASK_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * When containsActionRequest === false, skip the model call (preserves n8n
   * semantics: no-action emails yield an empty tasks array).
   */
  async extract(input: TaskExtractionEmailInput): Promise<TaskExtractionResult> {
    if (!input.containsActionRequest) {
      return emptyTaskExtractionResult();
    }

    if (!this.client) {
      throw new Error(
        "OpenAI is not configured (missing API key). Task extraction unavailable."
      );
    }

    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: taskExtractionSystemPrompt,
      userInput: buildTaskExtractionUserPrompt(input),
    });

    const parsed = await createJsonObjectResponse(this.client, params, "task");
    try {
      return parseTaskExtractionResult(parsed);
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        console.error(
          buildStageValidationFailedLog({
            stage: "task",
            parsed,
            error,
          })
        );
      }
      throw error;
    }
  }
}
