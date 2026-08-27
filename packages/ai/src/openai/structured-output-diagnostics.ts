/**
 * Safe structured-output validation diagnostics.
 * Never logs email bodies, raw model text, or secret material — keys/types/issues only.
 */

import { SemanticSignalValidationError } from "../semantic-signals/types.js";
import {
  sanitizeDiagnosticValue,
  type OpenAIResponsesStage,
} from "./openai-error-diagnostics.js";
import { StructuredOutputValidationError } from "./responses-json.js";

export type StructuredValidationIssue = {
  path: Array<string | number>;
  code: string;
  message: string;
  expected?: string;
  received?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function receivedTypeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Safe shape summary of a parsed JSON object (keys only; no values). */
export function summarizeParsedStructuredShape(parsed: unknown): {
  returnedTopLevelKeys: string[] | null;
  explanationKeys: string[] | null;
  receivedTopLevelTypes: Record<string, string> | null;
  wrapperSuspected: boolean;
} {
  if (!isPlainObject(parsed)) {
    return {
      returnedTopLevelKeys: null,
      explanationKeys: null,
      receivedTopLevelTypes: null,
      wrapperSuspected: false,
    };
  }

  const returnedTopLevelKeys = Object.keys(parsed);
  const receivedTopLevelTypes: Record<string, string> = {};
  for (const key of returnedTopLevelKeys) {
    receivedTopLevelTypes[key] = receivedTypeLabel(parsed[key]);
  }

  const explanations = parsed.signalExplanations;
  const explanationKeys = isPlainObject(explanations)
    ? Object.keys(explanations)
    : null;

  // Common json_object drift: model wraps payload under a single nested object.
  const wrapperSuspected =
    returnedTopLevelKeys.length === 1 &&
    !returnedTopLevelKeys.includes("contentBusinessProbability") &&
    !returnedTopLevelKeys.includes("businessType") &&
    !returnedTopLevelKeys.includes("tasks") &&
    !returnedTopLevelKeys.includes("selectedCustomerId") &&
    isPlainObject(parsed[returnedTopLevelKeys[0]!]);

  return {
    returnedTopLevelKeys,
    explanationKeys,
    receivedTopLevelTypes,
    wrapperSuspected,
  };
}

/** Map our hand-written semantic issue strings into structured diagnostics. */
export function structuredIssuesFromSemanticMessages(
  messages: string[]
): StructuredValidationIssue[] {
  return messages.map((message) => {
    const unexpectedTop = /^unexpected top-level property "([^"]+)"$/.exec(
      message
    );
    if (unexpectedTop) {
      return {
        path: [unexpectedTop[1]!],
        code: "unexpected_property",
        message,
      };
    }

    const missing = /^missing required field "([^"]+)"$/.exec(message);
    if (missing) {
      return {
        path: [missing[1]!],
        code: "missing_required",
        message,
        expected: "present",
        received: "undefined",
      };
    }

    const unexpectedExpl =
      /^unexpected signalExplanations property "([^"]+)"$/.exec(message);
    if (unexpectedExpl) {
      return {
        path: ["signalExplanations", unexpectedExpl[1]!],
        code: "unexpected_property",
        message,
      };
    }

    const explType = /^signalExplanations\.(\w+) must be a string$/.exec(
      message
    );
    if (explType) {
      return {
        path: ["signalExplanations", explType[1]!],
        code: "invalid_type",
        message,
        expected: "string",
      };
    }

    const mustBe = /^(\S+) must be a (finite number|boolean|string|JSON object)$/.exec(
      message
    );
    if (mustBe) {
      return {
        path: mustBe[1]!.split("."),
        code: "invalid_type",
        message,
        expected: mustBe[2]!,
      };
    }

    const range = /^(\S+) must be between 0 and 1/.exec(message);
    if (range) {
      return {
        path: range[1]!.split("."),
        code: "out_of_range",
        message,
        expected: "number 0..1",
      };
    }

    const maxLen = /^(\S+) must be ≤(\d+) characters/.exec(message);
    if (maxLen) {
      return {
        path: maxLen[1]!.split("."),
        code: "too_long",
        message,
        expected: `string length ≤${maxLen[2]}`,
      };
    }

    if (message.includes("deadlineUrgency must be one of")) {
      return {
        path: ["deadlineUrgency"],
        code: "invalid_enum",
        message,
        expected: "NONE | STANDARD | URGENT",
      };
    }

    if (message.includes('deadlineUrgency must be "NONE"')) {
      return {
        path: ["deadlineUrgency"],
        code: "inconsistent_deadline",
        message,
        expected: "NONE",
      };
    }

    if (message.includes("signalExplanations must be an object")) {
      return {
        path: ["signalExplanations"],
        code: "invalid_type",
        message,
        expected: "object",
      };
    }

    return { path: [], code: "custom", message };
  });
}

/** Extract Zod issues when present (path/code/message only; no input values). */
export function structuredIssuesFromZodError(
  error: unknown
): StructuredValidationIssue[] | null {
  if (!error || typeof error !== "object") return null;
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;

  const out: StructuredValidationIssue[] = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const row = issue as Record<string, unknown>;
    const path = Array.isArray(row.path)
      ? row.path.filter(
          (p): p is string | number =>
            typeof p === "string" || typeof p === "number"
        )
      : [];
    const code = typeof row.code === "string" ? row.code : "unknown";
    const message = typeof row.message === "string" ? row.message : "invalid";
    const expected =
      typeof row.expected === "string"
        ? row.expected
        : Array.isArray(row.options)
          ? row.options.map(String).join(" | ")
          : undefined;
    const received =
      typeof row.received === "string" || typeof row.received === "number"
        ? String(row.received)
        : row.received === null
          ? "null"
          : undefined;

    out.push({
      path,
      code,
      message,
      ...(expected ? { expected } : {}),
      ...(received ? { received } : {}),
    });
  }

  return out.length > 0 ? out : null;
}

export function buildSemanticValidationFailedLog(input: {
  parsed: unknown;
  error: SemanticSignalValidationError;
}): Record<string, unknown> {
  const shape = summarizeParsedStructuredShape(input.parsed);
  return sanitizeDiagnosticValue({
    event: "semantic-validation-failed",
    returnedTopLevelKeys: shape.returnedTopLevelKeys,
    explanationKeys: shape.explanationKeys,
    receivedTopLevelTypes: shape.receivedTopLevelTypes,
    wrapperSuspected: shape.wrapperSuspected,
    issues: structuredIssuesFromSemanticMessages(input.error.issues),
  }) as Record<string, unknown>;
}

export function buildStageValidationFailedLog(input: {
  stage: OpenAIResponsesStage;
  parsed: unknown;
  error: StructuredOutputValidationError;
}): Record<string, unknown> {
  const shape = summarizeParsedStructuredShape(input.parsed);
  return sanitizeDiagnosticValue({
    event: "structured-validation-failed",
    stage: input.stage,
    returnedTopLevelKeys: shape.returnedTopLevelKeys,
    explanationKeys: shape.explanationKeys,
    receivedTopLevelTypes: shape.receivedTopLevelTypes,
    wrapperSuspected: shape.wrapperSuspected,
    issues: input.error.issues.map((message) => ({
      path: [],
      code: "custom",
      message,
    })),
  }) as Record<string, unknown>;
}
