/**
 * Optional AI + attachment-text deps for Bid staging pipeline.
 * Failures never abort Scan Bids — callers treat null/empty as no enrichment.
 */

import type OpenAI from "openai";
import {
  createOpenAIClient,
  OpenAIBidFieldExtractor,
  OpenAIExistingJobAdjudicator,
  OpenAIQuoteFieldExtractor,
  OpenAIQuoteMatchAdjudicator,
} from "@forgeops/ai";
import type { BidEmailAnalyzeProgress } from "@forgeops/shared";

export type BidStagingAiContext = {
  client: OpenAI | null;
  bidExtractor: OpenAIBidFieldExtractor;
  quoteExtractor: OpenAIQuoteFieldExtractor;
  quoteMatchAdjudicator: OpenAIQuoteMatchAdjudicator;
  existingJobAdjudicator: OpenAIExistingJobAdjudicator;
  readObject: ((storageKey: string) => Promise<Buffer | null>) | null;
};

export function createBidStagingAiContext(input: {
  openaiApiKey?: string | null;
  openaiModel?: string;
  readObject?: ((storageKey: string) => Promise<Buffer | null>) | null;
}): BidStagingAiContext {
  const key =
    typeof input.openaiApiKey === "string" && input.openaiApiKey.trim()
      ? input.openaiApiKey.trim()
      : null;
  const client = key ? createOpenAIClient({ apiKey: key }) : createOpenAIClient({});
  const model = input.openaiModel;
  return {
    client,
    bidExtractor: model
      ? new OpenAIBidFieldExtractor(client, model)
      : new OpenAIBidFieldExtractor(client),
    quoteExtractor: model
      ? new OpenAIQuoteFieldExtractor(client, model)
      : new OpenAIQuoteFieldExtractor(client),
    quoteMatchAdjudicator: model
      ? new OpenAIQuoteMatchAdjudicator(client, model)
      : new OpenAIQuoteMatchAdjudicator(client),
    existingJobAdjudicator: model
      ? new OpenAIExistingJobAdjudicator(client, model)
      : new OpenAIExistingJobAdjudicator(client),
    readObject: input.readObject ?? null,
  };
}

export function bumpAiCalls(
  progress: BidEmailAnalyzeProgress,
  operation: string,
  count = 1
): void {
  progress.aiCalls = (progress.aiCalls ?? 0) + count;
  const by = progress.aiCallsByOperation ?? {};
  by[operation] = (by[operation] ?? 0) + count;
  progress.aiCallsByOperation = by;
}

/** Subject patterns that usually amend an existing invite (not a new Bid). */
export function inviteEmailRoleFromSubject(
  subject: string | null
): "BID_INVITE" | "ADDENDUM" | "SUPPORTING" {
  const s = subject ?? "";
  if (/\b(addendum|addenda|asi\s*\d+|revised\s+drawings?|bid\s+date\s+extension)\b/i.test(s)) {
    return "ADDENDUM";
  }
  if (/\b(reminder|bids?\s+due|follow[\s-]?up)\b/i.test(s)) {
    return "SUPPORTING";
  }
  return "BID_INVITE";
}
