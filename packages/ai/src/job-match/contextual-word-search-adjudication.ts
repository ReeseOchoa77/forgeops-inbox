/**
 * Optional LLM adjudication for Job Matcher V2.4 contextual word search.
 * Never invents Jobs — shortlist only. Failures return abstention.
 */

import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
} from "../openai/responses-json.js";
import type { ContextualWordSearchAiDecision } from "@forgeops/shared";

export type ContextualWordSearchAdjudicationInput = {
  subject: string;
  cleanBody: string;
  candidates: Array<{
    jobId: string;
    name: string;
    aliases?: string[];
    distinguishingTerms: string[];
    compoundNumericIdentities?: string[];
  }>;
  matchedTerms: string[];
  deterministicEvidence: string;
  /** Deterministic compound keys already extracted (e.g. building:3). */
  compoundNumericIdentities?: string[];
  /** Hard cap — never send the full Job directory. */
  maxCandidates?: number;
};

export const contextualWordSearchAdjudicationSystemPrompt = `You disambiguate which Job an email is about among a shortlist that already share a project-family identifier.

Return ONLY JSON:
{
  "selectedJobId": string | null,
  "decision": "MATCH" | "AMBIGUOUS" | "CONFLICT" | "NO_MATCH",
  "supportingEvidence": string[],
  "competingJobIds": string[],
  "interpretation": "PRIMARY" | "INCIDENTAL" | "NEGATED" | "CORRECTION" | "UNCERTAIN",
  "explanation": string,
  "confidence": number
}

Rules:
- You may ONLY choose a jobId from the provided candidates.
- Prefer AMBIGUOUS / NO_MATCH / abstention over a weak guess.
- MATCH only with clear positive evidence that the current work is that Job.
- Negated or incidental mentions are not positive evidence.
- Explicit corrections → CONFLICT or AMBIGUOUS unless clearly resolved.
- supportingEvidence must be exact excerpts from the subject or body.
- Do not invent Jobs or override eligibility.
- Standalone numbers (e.g. "3", "three") are NEVER project identity evidence.
- Compound numeric identifiers are pre-normalized (Building 3 / Bldg #3 → building:3). Trust those keys; do not re-decide whether #3 equals 3.
- Contradictory compounds (building:1 vs building:2) → CONFLICT, not score accumulation.

json`;

function buildUserPrompt(input: ContextualWordSearchAdjudicationInput): string {
  const max = Math.min(input.maxCandidates ?? 8, 8);
  return [
    "Subject:",
    input.subject,
    "",
    "Current body:",
    input.cleanBody.slice(0, 6000),
    "",
    "Candidates (only these ids are valid):",
    JSON.stringify(input.candidates.slice(0, max)),
    "",
    "Matched distinguishing terms:",
    JSON.stringify(input.matchedTerms),
    "",
    "Deterministic compound numeric identities:",
    JSON.stringify(input.compoundNumericIdentities ?? []),
    "",
    "Deterministic evidence:",
    input.deterministicEvidence,
  ].join("\n");
}

export function emptyContextualWordSearchAiDecision(): ContextualWordSearchAiDecision {
  return {
    selectedJobId: null,
    decision: "NO_MATCH",
    supportingEvidence: [],
    competingJobIds: [],
    interpretation: "UNCERTAIN",
    explanation: "AI unavailable or abstained",
    confidence: 0,
  };
}

export class OpenAIContextualWordSearchAdjudicator {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string = DEFAULT_CLASSIFICATION_AI_MODEL,
    private readonly options?: { timeoutMs?: number }
  ) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async adjudicate(
    input: ContextualWordSearchAdjudicationInput
  ): Promise<ContextualWordSearchAiDecision> {
    if (!this.client || input.candidates.length === 0) {
      return emptyContextualWordSearchAiDecision();
    }
    const allowed = new Set(input.candidates.map((c) => c.jobId));
    const params = buildJsonObjectResponseParams({
      model: this.model,
      instructions: contextualWordSearchAdjudicationSystemPrompt,
      userInput: buildUserPrompt(input),
      maxOutputTokens: 400,
    });
    try {
      const timeoutMs = this.options?.timeoutMs ?? 12_000;
      const parsed = await Promise.race([
        createJsonObjectResponse(
          this.client,
          params,
          "job_match_contextual_adjudicate"
        ),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs)
        ),
      ]);
      if (!parsed || typeof parsed !== "object") {
        return emptyContextualWordSearchAiDecision();
      }
      const o = parsed as Record<string, unknown>;
      const decision =
        o.decision === "MATCH" ||
        o.decision === "AMBIGUOUS" ||
        o.decision === "CONFLICT" ||
        o.decision === "NO_MATCH"
          ? o.decision
          : "NO_MATCH";
      let selectedJobId =
        typeof o.selectedJobId === "string" ? o.selectedJobId : null;
      if (selectedJobId && !allowed.has(selectedJobId)) {
        selectedJobId = null;
      }
      const competingJobIds = Array.isArray(o.competingJobIds)
        ? o.competingJobIds.filter(
            (id): id is string => typeof id === "string" && allowed.has(id)
          )
        : [];
      const supportingEvidence = Array.isArray(o.supportingEvidence)
        ? o.supportingEvidence.filter((e): e is string => typeof e === "string")
        : [];
      const interpretation =
        o.interpretation === "PRIMARY" ||
        o.interpretation === "INCIDENTAL" ||
        o.interpretation === "NEGATED" ||
        o.interpretation === "CORRECTION" ||
        o.interpretation === "UNCERTAIN"
          ? o.interpretation
          : "UNCERTAIN";
      return {
        selectedJobId: decision === "MATCH" ? selectedJobId : null,
        decision,
        supportingEvidence,
        competingJobIds,
        interpretation,
        explanation:
          typeof o.explanation === "string" ? o.explanation : "",
        confidence:
          typeof o.confidence === "number" && Number.isFinite(o.confidence)
            ? o.confidence
            : 0,
      };
    } catch {
      return emptyContextualWordSearchAiDecision();
    }
  }
}
