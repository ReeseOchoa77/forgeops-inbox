/**
 * OpenAI embeddings for Subtype Discovery.
 * Treats email text as untrusted data — never executes instructions found in content.
 */

import type OpenAI from "openai";
import {
  SUBTYPE_DISCOVERY_EMBEDDING_MODEL,
} from "@forgeops/shared";
import {
  extractOpenAiUsage,
  recordAiOperation,
} from "../openai/ai-operation-metrics.js";

const BATCH_SIZE = 64;

export async function embedTextsForSubtypeDiscovery(
  client: OpenAI,
  texts: string[],
  options?: { model?: string; onBatch?: (done: number, total: number) => void | Promise<void> }
): Promise<number[][]> {
  const model = options?.model ?? SUBTYPE_DISCOVERY_EMBEDDING_MODEL;
  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    const started = Date.now();
    const response = await client.embeddings.create({
      model,
      input: slice.map((t) => t.slice(0, 8000)),
    });
    const usage = extractOpenAiUsage(response);
    try {
      recordAiOperation({
        operation: "subtype_discovery_embed",
        model,
        durationMs: Date.now() - started,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        retryCount: 0,
        success: true,
        errorCode: null,
        recordCount: slice.length,
      });
    } catch {
      /* metrics best-effort */
    }
    for (const row of response.data) {
      out[i + row.index] = row.embedding;
    }
    if (options?.onBatch) {
      await options.onBatch(Math.min(i + slice.length, texts.length), texts.length);
    }
  }
  return out;
}
