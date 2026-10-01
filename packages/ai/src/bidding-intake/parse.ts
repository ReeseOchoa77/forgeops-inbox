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

function asStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const t = item.trim().slice(0, 300);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
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
  if (
    value.alternateProjectNames != null &&
    !Array.isArray(value.alternateProjectNames)
  ) {
    issues.push("alternateProjectNames must be an array");
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
  const alternateProjectNames = asStringArray(value.alternateProjectNames).filter(
    (a) => a.toLowerCase() !== (projectName ?? "").toLowerCase()
  );
  return {
    projectName: projectName ? projectName.slice(0, 300) : null,
    alternateProjectNames,
    bidDueDate,
    customerCompanyName: customerCompanyName
      ? customerCompanyName.slice(0, 200)
      : null,
  };
}
