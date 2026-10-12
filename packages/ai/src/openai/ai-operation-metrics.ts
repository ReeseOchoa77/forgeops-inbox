/**
 * Lightweight AI operation telemetry (local/dev observability).
 * Never stores prompts, email bodies, or model response text.
 */

export type AiOperationMetric = {
  operation: string;
  model: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  retryCount: number;
  success: boolean;
  errorCode: string | null;
  /** Optional non-sensitive batch size (e.g. images). */
  recordCount: number | null;
  at: string;
};

const MAX_RING = 200;
const ring: AiOperationMetric[] = [];

/** Rough estimator when provider usage is missing (~4 chars/token). */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function recordAiOperation(
  input: Omit<AiOperationMetric, "at" | "totalTokens"> & {
    totalTokens?: number | null;
  }
): AiOperationMetric {
  const inputTokens = input.inputTokens;
  const outputTokens = input.outputTokens;
  const totalTokens =
    input.totalTokens ??
    (inputTokens != null && outputTokens != null
      ? inputTokens + outputTokens
      : null);

  const metric: AiOperationMetric = {
    operation: input.operation,
    model: input.model,
    durationMs: input.durationMs,
    inputTokens,
    outputTokens,
    totalTokens,
    retryCount: input.retryCount,
    success: input.success,
    errorCode: input.errorCode,
    recordCount: input.recordCount,
    at: new Date().toISOString(),
  };

  ring.push(metric);
  if (ring.length > MAX_RING) ring.shift();

  // Structured log — numeric/operational only (no bodies/prompts).
  try {
    console.info(
      JSON.stringify({
        event: "ai_operation_metric",
        ...metric,
      })
    );
  } catch {
    /* never fail the business path */
  }

  return metric;
}

export function getRecentAiOperationMetrics(): AiOperationMetric[] {
  return [...ring];
}

export function summarizeAiOperationMetrics(
  metrics: AiOperationMetric[] = ring
): {
  calls: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  byOperation: Record<
    string,
    { calls: number; inputTokens: number; outputTokens: number; durationMs: number }
  >;
} {
  const byOperation: Record<
    string,
    { calls: number; inputTokens: number; outputTokens: number; durationMs: number }
  > = {};
  let successes = 0;
  let failures = 0;
  let totalDurationMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const m of metrics) {
    if (m.success) successes += 1;
    else failures += 1;
    totalDurationMs += m.durationMs;
    inputTokens += m.inputTokens ?? 0;
    outputTokens += m.outputTokens ?? 0;
    const bucket = byOperation[m.operation] ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    };
    bucket.calls += 1;
    bucket.inputTokens += m.inputTokens ?? 0;
    bucket.outputTokens += m.outputTokens ?? 0;
    bucket.durationMs += m.durationMs;
    byOperation[m.operation] = bucket;
  }

  return {
    calls: metrics.length,
    successes,
    failures,
    totalDurationMs,
    inputTokens,
    outputTokens,
    byOperation,
  };
}

/** Test helper — clears the in-memory ring. */
export function resetAiOperationMetricsForTests(): void {
  ring.length = 0;
}

export function extractOpenAiUsage(response: {
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
  } | null;
}): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  const u = response.usage;
  if (!u) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const inputTokens =
    typeof u.input_tokens === "number"
      ? u.input_tokens
      : typeof u.prompt_tokens === "number"
        ? u.prompt_tokens
        : null;
  const outputTokens =
    typeof u.output_tokens === "number"
      ? u.output_tokens
      : typeof u.completion_tokens === "number"
        ? u.completion_tokens
        : null;
  const totalTokens =
    typeof u.total_tokens === "number"
      ? u.total_tokens
      : inputTokens != null && outputTokens != null
        ? inputTokens + outputTokens
        : null;
  return { inputTokens, outputTokens, totalTokens };
}
