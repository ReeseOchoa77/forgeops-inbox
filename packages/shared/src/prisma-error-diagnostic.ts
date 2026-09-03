/**
 * Compact Prisma client-error diagnostics for logs / classificationError.
 * Prefer the useful field validation line over the huge invocation dump.
 */

const MAX_COMPACT = 360;

const FIELD_PATTERNS: RegExp[] = [
  /Invalid value for argument `([^`]+)`[^\n]*/i,
  /Argument `([^`]+)` is missing[^\n]*/i,
  /Unknown argument `([^`]+)`[^\n]*/i,
  /Argument `([^`]+)`: Invalid value provided[^\n]*/i,
  /Null constraint violation on the fields: \(`([^`]+)`\)/i,
  /Foreign key constraint violated on the fields: \(`([^`]+)`\)/i,
];

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Extract the most useful Prisma validation/constraint line and field name.
 * Does not include full invocation objects or stack traces.
 */
export function extractPrismaClientDiagnostic(error: unknown): {
  invalidField: string | null;
  compactMessage: string;
  errorName: string | null;
  prismaCode: string | null;
} {
  const errorName =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : error instanceof Error
        ? error.constructor.name
        : null;

  const prismaCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : null;

  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "unknown");

  let invalidField: string | null = null;
  let bestLine: string | null = null;

  for (const pattern of FIELD_PATTERNS) {
    const matches = [...raw.matchAll(new RegExp(pattern.source, "gi"))];
    const last = matches[matches.length - 1];
    if (last) {
      invalidField = last[1] ?? null;
      bestLine = collapseWhitespace(last[0] ?? "");
      break;
    }
  }

  if (!bestLine) {
    // Fall back to the last non-brace, non-empty line (often the real reason).
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("{") && !l.startsWith("}") && !l.startsWith("where:") && !l.startsWith("data:") && !l.startsWith("create:") && !l.startsWith("update:"));
    const tail = lines[lines.length - 1] ?? collapseWhitespace(raw);
    bestLine = collapseWhitespace(tail).slice(0, MAX_COMPACT);
  }

  const compactMessage = bestLine.slice(0, MAX_COMPACT);
  return { invalidField, compactMessage, errorName, prismaCode };
}

/**
 * Build a bounded classificationError / log line with stage prefix.
 * Example: TASK_PERSIST_FAILED: Invalid value for argument `dueAt`. ...
 */
export function formatClassificationFailureMessage(
  stage: string,
  error: unknown
): string {
  const { compactMessage, invalidField } = extractPrismaClientDiagnostic(error);
  const prefix = stage.trim().toUpperCase().replace(/\s+/g, "_");
  const body =
    compactMessage ||
    (error instanceof Error ? error.message : String(error ?? "unknown"));
  const withField =
    invalidField && !body.includes(`\`${invalidField}\``)
      ? `${body} (field: ${invalidField})`
      : body;
  return `${prefix}: ${withField}`.slice(0, 480);
}
