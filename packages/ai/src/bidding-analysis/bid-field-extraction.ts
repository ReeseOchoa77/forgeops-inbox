/**
 * Optional AI structured Bid Candidate field extraction.
 * ONE call fills missing fields — never invents absent operational data.
 */

import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import { buildStageValidationFailedLog } from "../openai/structured-output-diagnostics.js";

export const BID_FIELD_EXTRACT_MODEL = DEFAULT_CLASSIFICATION_AI_MODEL;

export type BidFieldExtractionInput = {
  subject: string;
  bodyText: string;
  senderName?: string | null;
  senderEmail?: string | null;
  pdfFilenames?: string[];
  /** Bounded relevant PDF text (already section-selected). */
  pdfText?: string | null;
  deterministic: {
    projectName: string | null;
    customerName: string | null;
    projectNumber: string | null;
    bidDueDate: string | null;
    scope: string | null;
    notes: string | null;
  };
};

export type BidFieldExtractionResult = {
  projectName: string | null;
  customerName: string | null;
  projectNumber: string | null;
  bidDueAt: string | null;
  location: string | null;
  scope: string | null;
  notes: string | null;
  confidence: number | null;
  fieldStatus: Record<string, "FOUND" | "INFERRED" | "UNKNOWN">;
};

const systemPrompt = `You extract Bid Invite fields for a steel fabrication shop CRM staging system.

Return ONLY JSON:
{
  "projectName": string | null,
  "customerName": string | null,
  "projectNumber": string | null,
  "bidDueAt": "YYYY-MM-DD" | null,
  "location": string | null,
  "scope": string | null,
  "notes": string | null,
  "confidence": number | null,
  "fieldStatus": {
    "projectName": "FOUND" | "INFERRED" | "UNKNOWN",
    "customerName": "FOUND" | "INFERRED" | "UNKNOWN",
    "projectNumber": "FOUND" | "INFERRED" | "UNKNOWN",
    "bidDueAt": "FOUND" | "INFERRED" | "UNKNOWN",
    "location": "FOUND" | "INFERRED" | "UNKNOWN",
    "scope": "FOUND" | "INFERRED" | "UNKNOWN",
    "notes": "FOUND" | "INFERRED" | "UNKNOWN"
  }
}

CRITICAL — do NOT invent operational Job data:
- FOUND = explicitly present in evidence (subject/body/PDF text/filenames).
- INFERRED = reasonable support from evidence (e.g. customer from invite language).
- UNKNOWN = absent or conflicting — return null for that field.
- Prefer null over guessing for bidDueAt, projectNumber, customerName, projectName.
- bidDueAt is BID SUBMISSION deadline only (not pre-bid / RFI / meeting).
- customerName is inviting GC/CM/organization — not a person, not a bidding platform.
- scope is fabrication scope when stated (structural steel, misc metals, etc.).
- Deterministic hints may be wrong wrappers — override only with stronger evidence.
- Never invent prices.

json`;

function buildUserPrompt(input: BidFieldExtractionInput): string {
  const body = (input.bodyText ?? "").trim().slice(0, 5000);
  const pdf = (input.pdfText ?? "").trim().slice(0, 8000);
  const pdfs = (input.pdfFilenames ?? []).filter(Boolean).slice(0, 20);
  return [
    `Subject: ${input.subject || "(empty)"}`,
    `senderName: ${input.senderName?.trim() || "(empty)"}`,
    `senderEmail: ${input.senderEmail?.trim() || "(empty)"}`,
    `pdfFilenames: ${pdfs.length ? pdfs.join(" | ") : "(none)"}`,
    `deterministic: ${JSON.stringify(input.deterministic)}`,
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

function parseResult(raw: unknown): BidFieldExtractionResult {
  if (!raw || typeof raw !== "object") {
    return emptyBidFieldExtractionResult();
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

  const pick = (key: string): string | null => {
    const st = statusOf(key);
    if (st === "UNKNOWN") return null;
    return asNullString(o[key]);
  };

  return {
    projectName: pick("projectName"),
    customerName: pick("customerName"),
    projectNumber: pick("projectNumber"),
    bidDueAt: pick("bidDueAt"),
    location: pick("location"),
    scope: pick("scope"),
    notes: pick("notes"),
    confidence: conf,
    fieldStatus: {
      projectName: statusOf("projectName"),
      customerName: statusOf("customerName"),
      projectNumber: statusOf("projectNumber"),
      bidDueAt: statusOf("bidDueAt"),
      location: statusOf("location"),
      scope: statusOf("scope"),
      notes: statusOf("notes"),
    },
  };
}

export function emptyBidFieldExtractionResult(): BidFieldExtractionResult {
  return {
    projectName: null,
    customerName: null,
    projectNumber: null,
    bidDueAt: null,
    location: null,
    scope: null,
    notes: null,
    confidence: null,
    fieldStatus: {
      projectName: "UNKNOWN",
      customerName: "UNKNOWN",
      projectNumber: "UNKNOWN",
      bidDueAt: "UNKNOWN",
      location: "UNKNOWN",
      scope: "UNKNOWN",
      notes: "UNKNOWN",
    },
  };
}

export class OpenAIBidFieldExtractor {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = BID_FIELD_EXTRACT_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async extract(
    input: BidFieldExtractionInput
  ): Promise<BidFieldExtractionResult> {
    if (!this.client) return emptyBidFieldExtractionResult();
    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: systemPrompt,
      userInput: buildUserPrompt(input),
      maxOutputTokens: 600,
    });
    try {
      const parsed = await createJsonObjectResponse(
        this.client,
        params,
        "bid_extract"
      );
      return parseResult(parsed);
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        console.error(
          buildStageValidationFailedLog({
            stage: "bid_extract",
            parsed: null,
            error,
          })
        );
      }
      return emptyBidFieldExtractionResult();
    }
  }
}
