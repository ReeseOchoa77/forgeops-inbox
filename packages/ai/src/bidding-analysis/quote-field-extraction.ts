/**
 * Optional AI structured Quote field extraction from body + bounded PDF text.
 */

import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import { buildStageValidationFailedLog } from "../openai/structured-output-diagnostics.js";
import {
  parseAiScopeDetail,
  SCOPE_DETAIL_JSON_SCHEMA_FRAGMENT,
  SCOPE_DETAIL_PROMPT_RULES,
  type AiScopeDetailPayload,
} from "./scope-detail-parse.js";

export const QUOTE_FIELD_EXTRACT_MODEL = DEFAULT_CLASSIFICATION_AI_MODEL;

export type QuoteFieldExtractionInput = {
  subject: string;
  bodyText: string;
  attachmentNames?: string[];
  pdfText?: string | null;
  deterministic: {
    scope: string | null;
    amount: number | null;
    currency: string | null;
    notes: string | null;
  };
};

export type QuoteFieldExtractionResult = {
  displayName: string | null;
  scope: string | null;
  scopeDetail: AiScopeDetailPayload | null;
  amount: number | null;
  currency: string | null;
  revision: string | null;
  projectName: string | null;
  projectNumber: string | null;
  customerName: string | null;
  vendorName: string | null;
  notes: string | null;
  confidence: number | null;
  fieldStatus: Record<string, "FOUND" | "INFERRED" | "UNKNOWN">;
};

const systemPrompt = `You extract steel fabrication Quote fields from email + PDF text for CRM staging.

Return ONLY JSON:
{
  "displayName": string | null,
  "scope": string | null,
  ${SCOPE_DETAIL_JSON_SCHEMA_FRAGMENT},
  "amount": number | null,
  "currency": "USD" | string | null,
  "revision": string | null,
  "projectName": string | null,
  "projectNumber": string | null,
  "customerName": string | null,
  "vendorName": string | null,
  "notes": string | null,
  "confidence": number | null,
  "fieldStatus": {
    "displayName": "FOUND" | "INFERRED" | "UNKNOWN",
    "scope": "FOUND" | "INFERRED" | "UNKNOWN",
    "amount": "FOUND" | "INFERRED" | "UNKNOWN",
    "currency": "FOUND" | "INFERRED" | "UNKNOWN",
    "revision": "FOUND" | "INFERRED" | "UNKNOWN",
    "projectName": "FOUND" | "INFERRED" | "UNKNOWN",
    "projectNumber": "FOUND" | "INFERRED" | "UNKNOWN",
    "customerName": "FOUND" | "INFERRED" | "UNKNOWN",
    "vendorName": "FOUND" | "INFERRED" | "UNKNOWN",
    "notes": "FOUND" | "INFERRED" | "UNKNOWN"
  }
}

CRITICAL:
- Do NOT invent amounts, project numbers, or customers.
- amount must appear explicitly as money in evidence; else null + UNKNOWN.
- Prefer FOUND only when clearly present; INFERRED only with strong support; else UNKNOWN/null.
- revision may be "Rev 2", "Revised", quote number if explicit.
- "scope" may be a short summary; put concrete quoted items/work in scopeDetail.
${SCOPE_DETAIL_PROMPT_RULES}
- Prefer PDF proposal/inclusions/exclusions/schedule-of-values language when present.
- Never hallucinate total price from unrelated numbers (phone, dates, qty alone).

json`;

function buildUserPrompt(input: QuoteFieldExtractionInput): string {
  const body = (input.bodyText ?? "").trim().slice(0, 4000);
  const pdf = (input.pdfText ?? "").trim().slice(0, 10000);
  const names = (input.attachmentNames ?? []).filter(Boolean).slice(0, 20);
  return [
    `Subject: ${input.subject || "(empty)"}`,
    `attachments: ${names.length ? names.join(" | ") : "(none)"}`,
    `deterministic: ${JSON.stringify(input.deterministic)}`,
    "",
    "Task: extract Quote amount/identity AND concrete Quote scope items/work from evidence.",
    "Do not invent a standard structural-steel bill of materials.",
    "",
    "Email body:",
    body || "(empty)",
    "",
    "Relevant PDF text (bounded):",
    pdf || "(none)",
  ].join("\n");
}

function asNullString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function asAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 100 && v <= 1e9) {
    return Math.round(v * 100) / 100;
  }
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""));
    if (Number.isFinite(n) && n >= 100 && n <= 1e9) return Math.round(n * 100) / 100;
  }
  return null;
}

function parseResult(raw: unknown): QuoteFieldExtractionResult {
  if (!raw || typeof raw !== "object") {
    return emptyQuoteFieldExtractionResult();
  }
  const o = raw as Record<string, unknown>;
  const fieldStatusRaw =
    o.fieldStatus && typeof o.fieldStatus === "object"
      ? (o.fieldStatus as Record<string, unknown>)
      : {};
  const statusOf = (k: string): "FOUND" | "INFERRED" | "UNKNOWN" => {
    const v = fieldStatusRaw[k];
    if (v === "FOUND" || v === "INFERRED" || v === "UNKNOWN") return v;
    return "UNKNOWN";
  };
  const conf =
    typeof o.confidence === "number" && Number.isFinite(o.confidence)
      ? Math.max(0, Math.min(1, o.confidence))
      : null;

  const amountStatus = statusOf("amount");
  const amount = amountStatus === "UNKNOWN" ? null : asAmount(o.amount);

  return {
    displayName:
      statusOf("displayName") === "UNKNOWN" ? null : asNullString(o.displayName),
    scope: statusOf("scope") === "UNKNOWN" ? null : asNullString(o.scope),
    scopeDetail: parseAiScopeDetail(o.scopeDetail),
    amount,
    currency:
      statusOf("currency") === "UNKNOWN"
        ? null
        : asNullString(o.currency) ?? (amount != null ? "USD" : null),
    revision:
      statusOf("revision") === "UNKNOWN" ? null : asNullString(o.revision),
    projectName:
      statusOf("projectName") === "UNKNOWN" ? null : asNullString(o.projectName),
    projectNumber:
      statusOf("projectNumber") === "UNKNOWN"
        ? null
        : asNullString(o.projectNumber),
    customerName:
      statusOf("customerName") === "UNKNOWN"
        ? null
        : asNullString(o.customerName),
    vendorName:
      statusOf("vendorName") === "UNKNOWN" ? null : asNullString(o.vendorName),
    notes: statusOf("notes") === "UNKNOWN" ? null : asNullString(o.notes),
    confidence: conf,
    fieldStatus: {
      displayName: statusOf("displayName"),
      scope: statusOf("scope"),
      amount: amountStatus,
      currency: statusOf("currency"),
      revision: statusOf("revision"),
      projectName: statusOf("projectName"),
      projectNumber: statusOf("projectNumber"),
      customerName: statusOf("customerName"),
      vendorName: statusOf("vendorName"),
      notes: statusOf("notes"),
    },
  };
}

export function emptyQuoteFieldExtractionResult(): QuoteFieldExtractionResult {
  return {
    displayName: null,
    scope: null,
    scopeDetail: null,
    amount: null,
    currency: null,
    revision: null,
    projectName: null,
    projectNumber: null,
    customerName: null,
    vendorName: null,
    notes: null,
    confidence: null,
    fieldStatus: {
      displayName: "UNKNOWN",
      scope: "UNKNOWN",
      amount: "UNKNOWN",
      currency: "UNKNOWN",
      revision: "UNKNOWN",
      projectName: "UNKNOWN",
      projectNumber: "UNKNOWN",
      customerName: "UNKNOWN",
      vendorName: "UNKNOWN",
      notes: "UNKNOWN",
    },
  };
}

export class OpenAIQuoteFieldExtractor {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = QUOTE_FIELD_EXTRACT_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async extract(
    input: QuoteFieldExtractionInput
  ): Promise<QuoteFieldExtractionResult> {
    if (!this.client) return emptyQuoteFieldExtractionResult();
    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: systemPrompt,
      userInput: buildUserPrompt(input),
      maxOutputTokens: 900,
    });
    try {
      const parsed = await createJsonObjectResponse(
        this.client,
        params,
        "quote_extract"
      );
      return parseResult(parsed);
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        console.error(
          buildStageValidationFailedLog({
            stage: "quote_extract",
            parsed: null,
            error,
          })
        );
      }
      return emptyQuoteFieldExtractionResult();
    }
  }
}
