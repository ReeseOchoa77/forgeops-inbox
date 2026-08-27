/**
 * Safe OpenAI / network error diagnostics for worker logs.
 * Never includes API keys, Authorization headers, bodies, or tokens.
 */

export type OpenAIResponsesStage = "semantic" | "subtype" | "entity" | "task";

const MAX_SANITIZE_DEPTH = 8;

/**
 * Redact secrets from a diagnostic string.
 * Applied to every string field in serialized OpenAI errors (including nested causes).
 */
export function redactSecretString(value: string): string {
  let out = value;
  // Authorization / Bearer header values (any token after Bearer)
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  out = out.replace(
    /Authorization\s*[:=]\s*\S+/gi,
    "Authorization: [REDACTED]"
  );
  // OpenAI secret key forms (proj keys before generic sk-)
  out = out.replace(/\bsk-proj-[A-Za-z0-9_\-]+/g, "[REDACTED_OPENAI_KEY]");
  out = out.replace(/\bsk-[A-Za-z0-9_\-]+/g, "[REDACTED_OPENAI_KEY]");
  // Common env / cookie leakage in free-form messages
  out = out.replace(/\bOPENAI_API_KEY\b\s*[:=]?\s*\S+/gi, "OPENAI_API_KEY=[REDACTED]");
  out = out.replace(/\b(?:set-)?cookie\s*[:=]\s*[^\s;]+/gi, "cookie=[REDACTED]");
  return out;
}

function isSecretObjectKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === "authorization" || lower === "proxy-authorization") return true;
  if (lower === "api_key" || lower === "apikey" || lower === "openai_api_key") {
    return true;
  }
  if (lower.includes("access_token") || lower.includes("refresh_token")) {
    return true;
  }
  if (lower === "cookie" || lower === "set-cookie") return true;
  return false;
}

/**
 * Recursively sanitize diagnostic values so secrets never reach logs.
 */
export function sanitizeDiagnosticValue(
  value: unknown,
  depth = 0
): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") return redactSecretString(value);
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "object") {
    return redactSecretString(String(value));
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretObjectKey(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeDiagnosticValue(child, depth + 1);
  }
  return out;
}

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
    return { message: redactSecretString(String(cause)) };
  }
  const c = cause as Record<string, unknown>;
  const name =
    typeof (cause as { name?: unknown }).name === "string"
      ? (cause as { name: string }).name
      : cause.constructor?.name ?? null;
  const message =
    typeof (cause as { message?: unknown }).message === "string"
      ? redactSecretString((cause as { message: string }).message)
      : null;

  const nested =
    "cause" in c ? serializeCause(c.cause) : null;

  return {
    name,
    message,
    code: readStringProp(c, "code"),
    errno: readNumberProp(c, "errno") ?? readStringProp(c, "errno"),
    syscall: readStringProp(c, "syscall"),
    hostname: readStringProp(c, "hostname"),
    ...(nested ? { cause: nested } : {}),
  };
}

/**
 * Flatten an unknown thrown value into a JSON-safe diagnostic object.
 * Prefer nested `cause` fields (Node fetch / undici / DNS / TLS).
 * All string fields are secret-redacted before return.
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
  zodIssues: Array<Record<string, unknown>> | null;
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
      zodIssues: null,
    };
  }

  if (typeof error !== "object") {
    return {
      errorName: null,
      errorMessage: redactSecretString(String(error)),
      constructorName: typeof error,
      status: null,
      code: null,
      type: null,
      requestId: null,
      cause: null,
      zodIssues: null,
    };
  }

  const err = error as Error & Record<string, unknown>;
  const causeRaw = "cause" in err ? err.cause : undefined;

  const raw = {
    errorName: typeof err.name === "string" ? err.name : null,
    errorMessage:
      typeof err.message === "string" ? redactSecretString(err.message) : null,
    constructorName: err.constructor?.name ?? null,
    status: readNumberProp(err, "status"),
    code: readStringProp(err, "code"),
    type: readStringProp(err, "type"),
    requestId:
      readStringProp(err, "request_id") ?? readStringProp(err, "requestId"),
    cause: serializeCause(causeRaw),
    zodIssues: structuredIssuesFromMaybeZod(err),
  };

  return sanitizeDiagnosticValue(raw) as typeof raw;
}

function structuredIssuesFromMaybeZod(
  error: object
): Array<Record<string, unknown>> | null {
  // Lazy import path avoided — inline minimal Zod issue extraction.
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const name =
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : error.constructor?.name;
  if (name !== "ZodError" && !(error as { name?: string }).name?.includes("Zod")) {
    // Still extract if it looks like Zod issues (path/code/message).
    const sample = issues[0];
    if (
      !sample ||
      typeof sample !== "object" ||
      !("code" in (sample as object)) ||
      !("path" in (sample as object))
    ) {
      return null;
    }
  }

  return issues
    .filter((issue): issue is Record<string, unknown> => !!issue && typeof issue === "object")
    .map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path : [];
      const expected =
        typeof issue.expected === "string"
          ? issue.expected
          : Array.isArray(issue.options)
            ? issue.options.map(String).join(" | ")
            : undefined;
      const received =
        typeof issue.received === "string" || typeof issue.received === "number"
          ? String(issue.received)
          : issue.received === null
            ? "null"
            : undefined;
      return {
        path,
        code: typeof issue.code === "string" ? issue.code : "unknown",
        message: typeof issue.message === "string" ? issue.message : "invalid",
        ...(expected ? { expected } : {}),
        ...(received ? { received } : {}),
      };
    });
}

export function buildOpenAiResponseFailedLog(input: {
  stage: OpenAIResponsesStage;
  model: string;
  error: unknown;
}): Record<string, unknown> {
  const serialized = serializeOpenAiError(input.error);
  return sanitizeDiagnosticValue({
    event: "openai-response-failed",
    stage: input.stage,
    model: input.model,
    ...serialized,
  }) as Record<string, unknown>;
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
