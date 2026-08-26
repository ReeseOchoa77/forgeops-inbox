/**
 * Safe OpenAI / network error diagnostics for worker logs.
 * Never includes API keys, Authorization headers, bodies, or tokens.
 */

export type OpenAIResponsesStage = "semantic" | "subtype" | "entity" | "task";

function readStringProp(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberProp(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function serializeCause(cause: unknown): Record<string, unknown> | null {
  if (cause == null) return null;
  if (typeof cause !== "object") {
    return { message: String(cause) };
  }
  const c = cause as Record<string, unknown>;
  const name =
    typeof (cause as { name?: unknown }).name === "string"
      ? (cause as { name: string }).name
      : cause.constructor?.name ?? null;
  const message =
    typeof (cause as { message?: unknown }).message === "string"
      ? (cause as { message: string }).message
      : null;

  return {
    name,
    message,
    code: readStringProp(c, "code"),
    errno: readNumberProp(c, "errno") ?? readStringProp(c, "errno"),
    syscall: readStringProp(c, "syscall"),
    hostname: readStringProp(c, "hostname"),
  };
}

/**
 * Flatten an unknown thrown value into a JSON-safe diagnostic object.
 * Prefer nested `cause` fields (Node fetch / undici / DNS / TLS).
 */
export function serializeOpenAiError(error: unknown): {
  errorName: string | null;
  errorMessage: string | null;
  constructorName: string | null;
  status: number | null;
  code: string | null;
  type: string | null;
  requestId: string | null;
  cause: Record<string, unknown> | null;
} {
  if (error == null) {
    return {
      errorName: null,
      errorMessage: null,
      constructorName: null,
      status: null,
      code: null,
      type: null,
      requestId: null,
      cause: null,
    };
  }

  if (typeof error !== "object") {
    return {
      errorName: null,
      errorMessage: String(error),
      constructorName: typeof error,
      status: null,
      code: null,
      type: null,
      requestId: null,
      cause: null,
    };
  }

  const err = error as Error & Record<string, unknown>;
  const causeRaw =
    "cause" in err
      ? err.cause
      : undefined;

  return {
    errorName: typeof err.name === "string" ? err.name : null,
    errorMessage: typeof err.message === "string" ? err.message : null,
    constructorName: err.constructor?.name ?? null,
    status: readNumberProp(err, "status"),
    code: readStringProp(err, "code"),
    type: readStringProp(err, "type"),
    requestId:
      readStringProp(err, "request_id") ?? readStringProp(err, "requestId"),
    cause: serializeCause(causeRaw),
  };
}

export function buildOpenAiResponseFailedLog(input: {
  stage: OpenAIResponsesStage;
  model: string;
  error: unknown;
}): Record<string, unknown> {
  const serialized = serializeOpenAiError(input.error);
  return {
    event: "openai-response-failed",
    stage: input.stage,
    model: input.model,
    ...serialized,
  };
}

/**
 * Run a Responses API call; on failure log stage diagnostics then rethrow.
 */
export async function withOpenAiResponsesDiagnostics<T>(
  input: {
    stage: OpenAIResponsesStage;
    model: string;
    log?: ((payload: Record<string, unknown>) => void) | undefined;
  },
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const payload = buildOpenAiResponseFailedLog({
      stage: input.stage,
      model: input.model,
      error,
    });
    const log = input.log ?? ((p) => console.error(p));
    log(payload);
    throw error;
  }
}
