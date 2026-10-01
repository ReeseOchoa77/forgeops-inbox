import {
  isPlainObject,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import type { BiddingIntakeExtractionResult } from "./prompt.js";

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

function asYmd(value: unknown): string | null {
  const s = asNullableString(value);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (y == null || m == null || d == null) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

export function parseBiddingIntakeResult(
  value: unknown
): BiddingIntakeExtractionResult {
  const issues: string[] = [];
  if (!isPlainObject(value)) {
    throw new StructuredOutputValidationError("biddingIntake", [
      "response must be a JSON object",
    ]);
  }
  const projectName = asNullableString(value.projectName);
  if (value.projectName != null && projectName == null && value.projectName !== null) {
    issues.push("projectName must be a string or null");
  }
  const bidDueDate = asYmd(value.bidDueDate);
  const customerCompanyName = asNullableString(value.customerCompanyName);
  if (
    value.customerCompanyName != null &&
    customerCompanyName == null &&
    value.customerCompanyName !== null
  ) {
    issues.push("customerCompanyName must be a string or null");
  }
  if (issues.length > 0) {
    throw new StructuredOutputValidationError("biddingIntake", issues);
  }
  return {
    projectName: projectName ? projectName.slice(0, 300) : null,
    bidDueDate,
    customerCompanyName: customerCompanyName
      ? customerCompanyName.slice(0, 200)
      : null,
  };
}
