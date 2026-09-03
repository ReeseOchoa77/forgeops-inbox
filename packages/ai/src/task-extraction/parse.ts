import { safeDateOrNull } from "@forgeops/shared";
import {
  isPlainObject,
  requireFiniteProbability,
  requireNullableString,
  requireString,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import type { ExtractedTask, TaskExtractionResult } from "./prompt.js";

const MAX_TASKS = 5;
const TASK_ALLOWED_KEYS = [
  "title",
  "description",
  "dueDate",
  "recommendedOwner",
  "confidence",
] as const;

export function parseTaskExtractionResult(raw: unknown): TaskExtractionResult {
  const issues: string[] = [];
  if (!isPlainObject(raw)) {
    throw new StructuredOutputValidationError("task extraction", [
      "response must be a JSON object",
    ]);
  }

  for (const key of Object.keys(raw)) {
    if (key !== "tasks") issues.push(`unexpected property "${key}"`);
  }
  if (!("tasks" in raw)) issues.push('missing required field "tasks"');

  if (!Array.isArray(raw.tasks)) {
    issues.push("tasks must be an array");
    throw new StructuredOutputValidationError("task extraction", issues);
  }

  if (raw.tasks.length > MAX_TASKS) {
    issues.push(`tasks must contain at most ${MAX_TASKS} items (got ${raw.tasks.length})`);
  }

  const tasks: ExtractedTask[] = [];
  for (let i = 0; i < raw.tasks.length; i++) {
    const item = raw.tasks[i];
    if (!isPlainObject(item)) {
      issues.push(`tasks[${i}] must be an object`);
      continue;
    }
    for (const key of Object.keys(item)) {
      if (!(TASK_ALLOWED_KEYS as readonly string[]).includes(key)) {
        issues.push(`tasks[${i}] unexpected property "${key}"`);
      }
    }

    const title = requireString(item.title, `tasks[${i}].title`, issues);
    const description = requireString(
      item.description,
      `tasks[${i}].description`,
      issues
    );
    const confidence = requireFiniteProbability(
      item.confidence,
      `tasks[${i}].confidence`,
      issues
    );

    // dueDate / recommendedOwner: optional; coerce unparseable dueDate → null (do not fail extraction).
    let dueDate: string | null = null;
    if ("dueDate" in item) {
      const parsed = requireNullableString(
        item.dueDate,
        `tasks[${i}].dueDate`,
        issues
      );
      if (parsed !== undefined) {
        if (parsed == null) {
          dueDate = null;
        } else {
          const d = safeDateOrNull(parsed);
          dueDate = d ? d.toISOString() : null;
        }
      }
    }

    let recommendedOwner: string | null = null;
    if ("recommendedOwner" in item) {
      const parsed = requireNullableString(
        item.recommendedOwner,
        `tasks[${i}].recommendedOwner`,
        issues
      );
      if (parsed !== undefined) recommendedOwner = parsed;
    }

    if (title != null && description != null && confidence != null) {
      tasks.push({
        title,
        description,
        dueDate,
        recommendedOwner,
        confidence,
      });
    }
  }

  if (issues.length > 0) {
    throw new StructuredOutputValidationError("task extraction", issues);
  }

  return { tasks };
}
