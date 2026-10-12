/**
 * AI adjudication among a narrowed Quote→Bid shortlist (never the full catalog).
 */

import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
  StructuredOutputValidationError,
} from "../openai/responses-json.js";
import { buildStageValidationFailedLog } from "../openai/structured-output-diagnostics.js";

export type MatchAdjudicationCandidate = {
  id: string;
  projectName: string | null;
  jobNumber: string | null;
  customerName: string | null;
  score: number;
  evidence: string[];
};

export type QuoteMatchAdjudicationInput = {
  quote: {
    subject: string | null;
    scope: string | null;
    amount: number | null;
    projectHints: string[];
    attachmentNames: string[];
  };
  shortlist: MatchAdjudicationCandidate[];
};

export type QuoteMatchAdjudicationResult = {
  bestCandidateId: string | null;
  confidence: number | null;
  reason: string | null;
  decision: "MATCH" | "UNMATCHED" | "INSUFFICIENT_EVIDENCE";
};

const systemPrompt = `You adjudicate whether a Quote email matches ONE Bid Candidate from a shortlist.

Return ONLY JSON:
{
  "bestCandidateId": string | null,
  "confidence": number | null,
  "reason": string | null,
  "decision": "MATCH" | "UNMATCHED" | "INSUFFICIENT_EVIDENCE"
}

Rules:
- You may ONLY choose a candidate id from the provided shortlist.
- Prefer UNMATCHED / INSUFFICIENT_EVIDENCE over a weak guess.
- MATCH only with clear project identity agreement (number, name, or strong multi-signal).
- Do not invent relationships.

json`;

function buildUserPrompt(input: QuoteMatchAdjudicationInput): string {
  return [
    "Quote:",
    JSON.stringify(input.quote),
    "",
    "Shortlist (only these ids are valid):",
    JSON.stringify(input.shortlist.slice(0, 5)),
  ].join("\n");
}

export function emptyQuoteMatchAdjudicationResult(): QuoteMatchAdjudicationResult {
  return {
    bestCandidateId: null,
    confidence: null,
    reason: null,
    decision: "INSUFFICIENT_EVIDENCE",
  };
}

export class OpenAIQuoteMatchAdjudicator {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_CLASSIFICATION_AI_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async adjudicate(
    input: QuoteMatchAdjudicationInput
  ): Promise<QuoteMatchAdjudicationResult> {
    if (!this.client || input.shortlist.length === 0) {
      return emptyQuoteMatchAdjudicationResult();
    }
    const allowed = new Set(input.shortlist.map((c) => c.id));
    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: systemPrompt,
      userInput: buildUserPrompt(input),
      maxOutputTokens: 300,
    });
    try {
      const parsed = await createJsonObjectResponse(
        this.client,
        params,
        "quote_match_adjudicate"
      );
      if (!parsed || typeof parsed !== "object") {
        return emptyQuoteMatchAdjudicationResult();
      }
      const o = parsed as Record<string, unknown>;
      const decision =
        o.decision === "MATCH" ||
        o.decision === "UNMATCHED" ||
        o.decision === "INSUFFICIENT_EVIDENCE"
          ? o.decision
          : "INSUFFICIENT_EVIDENCE";
      let bestCandidateId =
        typeof o.bestCandidateId === "string" ? o.bestCandidateId : null;
      if (bestCandidateId && !allowed.has(bestCandidateId)) {
        bestCandidateId = null;
      }
      if (decision !== "MATCH") {
        bestCandidateId = null;
      }
      const confidence =
        typeof o.confidence === "number" && Number.isFinite(o.confidence)
          ? Math.max(0, Math.min(1, o.confidence))
          : null;
      const reason =
        typeof o.reason === "string" ? o.reason.slice(0, 400) : null;
      // Weak AI match must not become canonical — require confidence.
      if (
        decision === "MATCH" &&
        (confidence == null || confidence < 0.7 || !bestCandidateId)
      ) {
        return {
          bestCandidateId: null,
          confidence,
          reason,
          decision: "INSUFFICIENT_EVIDENCE",
        };
      }
      return { bestCandidateId, confidence, reason, decision };
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        console.error(
          buildStageValidationFailedLog({
            stage: "quote_match_adjudicate",
            parsed: null,
            error,
          })
        );
      }
      return emptyQuoteMatchAdjudicationResult();
    }
  }
}

export type ExistingJobAdjudicationInput = {
  candidate: {
    projectName: string | null;
    jobNumber: string | null;
    customerName: string | null;
  };
  shortlist: Array<{
    jobId: string;
    jobNumber: string | null;
    name: string | null;
    customerName: string | null;
    score: number;
    evidence: string[];
  }>;
};

export type ExistingJobAdjudicationResult = {
  suggestedJobId: string | null;
  confidence: number | null;
  reason: string | null;
  /** Staging suggestion only — never RESOLVED_SAME. */
  decision: "POSSIBLE_EXISTING_JOB" | "INSUFFICIENT_EVIDENCE" | "NO_MATCH";
};

const existingJobSystem = `You suggest whether a Bid Candidate may already exist as a Job in the CRM.

Return ONLY JSON:
{
  "suggestedJobId": string | null,
  "confidence": number | null,
  "reason": string | null,
  "decision": "POSSIBLE_EXISTING_JOB" | "INSUFFICIENT_EVIDENCE" | "NO_MATCH"
}

Rules:
- Choose ONLY from the shortlist jobIds.
- This is a SUGGESTION for human review — never claim definitive resolution.
- Prefer INSUFFICIENT_EVIDENCE / NO_MATCH over weak guesses.

json`;

export function emptyExistingJobAdjudicationResult(): ExistingJobAdjudicationResult {
  return {
    suggestedJobId: null,
    confidence: null,
    reason: null,
    decision: "INSUFFICIENT_EVIDENCE",
  };
}

export class OpenAIExistingJobAdjudicator {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_CLASSIFICATION_AI_MODEL
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async adjudicate(
    input: ExistingJobAdjudicationInput
  ): Promise<ExistingJobAdjudicationResult> {
    if (!this.client || input.shortlist.length === 0) {
      return emptyExistingJobAdjudicationResult();
    }
    const allowed = new Set(input.shortlist.map((j) => j.jobId));
    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: existingJobSystem,
      userInput: [
        "Candidate:",
        JSON.stringify(input.candidate),
        "",
        "Shortlist:",
        JSON.stringify(input.shortlist.slice(0, 5)),
      ].join("\n"),
      maxOutputTokens: 300,
    });
    try {
      const parsed = await createJsonObjectResponse(
        this.client,
        params,
        "existing_job_adjudicate"
      );
      if (!parsed || typeof parsed !== "object") {
        return emptyExistingJobAdjudicationResult();
      }
      const o = parsed as Record<string, unknown>;
      const decision =
        o.decision === "POSSIBLE_EXISTING_JOB" ||
        o.decision === "INSUFFICIENT_EVIDENCE" ||
        o.decision === "NO_MATCH"
          ? o.decision
          : "INSUFFICIENT_EVIDENCE";
      let suggestedJobId =
        typeof o.suggestedJobId === "string" ? o.suggestedJobId : null;
      if (suggestedJobId && !allowed.has(suggestedJobId)) {
        suggestedJobId = null;
      }
      if (decision !== "POSSIBLE_EXISTING_JOB") suggestedJobId = null;
      const confidence =
        typeof o.confidence === "number" && Number.isFinite(o.confidence)
          ? Math.max(0, Math.min(1, o.confidence))
          : null;
      const reason =
        typeof o.reason === "string" ? o.reason.slice(0, 400) : null;
      return { suggestedJobId, confidence, reason, decision };
    } catch (error) {
      if (error instanceof StructuredOutputValidationError) {
        console.error(
          buildStageValidationFailedLog({
            stage: "existing_job_adjudicate",
            parsed: null,
            error,
          })
        );
      }
      return emptyExistingJobAdjudicationResult();
    }
  }
}
