import { describe, expect, it, beforeEach } from "vitest";
import {
  estimateTokensFromText,
  extractOpenAiUsage,
  getRecentAiOperationMetrics,
  recordAiOperation,
  resetAiOperationMetricsForTests,
  summarizeAiOperationMetrics,
} from "../openai/ai-operation-metrics.js";
import { createJsonObjectResponse } from "../openai/responses-json.js";

describe("ai-operation-metrics", () => {
  beforeEach(() => {
    resetAiOperationMetricsForTests();
  });

  it("records numeric-only metrics without prompt/body fields", () => {
    const metric = recordAiOperation({
      operation: "semantic",
      model: "chat-latest",
      durationMs: 120,
      inputTokens: 2000,
      outputTokens: 150,
      retryCount: 0,
      success: true,
      errorCode: null,
      recordCount: 1,
    });
    expect(metric.totalTokens).toBe(2150);
    const keys = Object.keys(metric).sort();
    expect(keys).toEqual(
      [
        "at",
        "durationMs",
        "errorCode",
        "inputTokens",
        "model",
        "operation",
        "outputTokens",
        "recordCount",
        "retryCount",
        "success",
        "totalTokens",
      ].sort()
    );
    expect(JSON.stringify(metric)).not.toMatch(/cleanBody|prompt|subject|Dear/i);
  });

  it("tolerates missing usage metadata", () => {
    expect(extractOpenAiUsage({})).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    recordAiOperation({
      operation: "subtype",
      model: "chat-latest",
      durationMs: 10,
      inputTokens: null,
      outputTokens: null,
      retryCount: 0,
      success: true,
      errorCode: null,
      recordCount: 1,
    });
    const summary = summarizeAiOperationMetrics(getRecentAiOperationMetrics());
    expect(summary.calls).toBe(1);
    expect(summary.inputTokens).toBe(0);
  });

  it("estimates tokens from text length", () => {
    expect(estimateTokensFromText("abcd".repeat(100))).toBe(100);
  });

  it("createJsonObjectResponse records usage and never requires usage to succeed", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({ ok: true }),
          usage: { input_tokens: 11, output_tokens: 3, total_tokens: 14 },
        }),
      },
    };
    const parsed = await createJsonObjectResponse(
      client as never,
      {
        model: "chat-latest",
        instructions: "x",
        input: "Return ONLY valid JSON matching the required output schema.\n\n{}",
        max_output_tokens: 100,
        text: { format: { type: "json_object" } },
      },
      "entity"
    );
    expect(parsed).toEqual({ ok: true });
    const recent = getRecentAiOperationMetrics();
    expect(recent[0]?.operation).toBe("entity");
    expect(recent[0]?.inputTokens).toBe(11);
    expect(recent[0]?.outputTokens).toBe(3);
  });
});
