import type OpenAI from "openai";

import type { EmailExtraction } from "@forgeops/shared";

import { inboxClassificationPrompt } from "../prompts/inbox-classification.prompt.js";

export interface ClassifyInboxInput {
  subject: string;
  from: string;
  bodyText: string;
}

export class OpenAIInboxClassifier {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async classify(input: ClassifyInboxInput): Promise<EmailExtraction> {
    void input;
    void this.model;
    void inboxClassificationPrompt;

    if (!this.client) {
      return this.placeholderExtraction();
    }

    // Placeholder until the Responses API contract and persistence shape are finalized.
    return this.placeholderExtraction();
  }

  private placeholderExtraction(): EmailExtraction {
    return {
      category: "NEEDS_REVIEW",
      summary: "Placeholder extraction. Wire the OpenAI Responses API here.",
      priority: "MEDIUM",
      labelHints: [],
      categoryHints: [],
      containsActionRequest: false,
      task: null,
      confidence: 0.15
    };
  }
}
