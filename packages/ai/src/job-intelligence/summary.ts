import type OpenAI from "openai";
import {
  emptySummarySections,
  parseSummarySections,
  type JobIntelligenceSummarySections,
} from "@forgeops/shared";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import { buildStageValidationFailedLog } from "../openai/structured-output-diagnostics.js";
import {
  buildJobIntelligenceSummaryUserPrompt,
  jobIntelligenceSummarySystemPrompt,
} from "./summary-prompt.js";

export class OpenAIJobIntelligenceSummarizer {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_CLASSIFICATION_AI_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async summarize(input: {
    jobName: string;
    events: Array<{ id: string; [key: string]: unknown }>;
  }): Promise<JobIntelligenceSummarySections> {
    if (!this.client || input.events.length === 0) {
      return emptySummarySections();
    }

    const allowedEventIds = new Set(input.events.map((e) => e.id));
    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: jobIntelligenceSummarySystemPrompt,
      userInput: buildJobIntelligenceSummaryUserPrompt({
        jobName: input.jobName,
        eventsJson: JSON.stringify(input.events).slice(0, 80_000),
      }),
      maxOutputTokens: 2000,
    });

    try {
      const parsed = await createJsonObjectResponse(
        this.client,
        params,
        "job_intelligence_summary"
      );
      return parseSummarySections(parsed, allowedEventIds);
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        console.error(
          buildStageValidationFailedLog({
            stage: "job_intelligence_summary",
            parsed: null,
            error,
          })
        );
      }
      return emptySummarySections();
    }
  }
}
