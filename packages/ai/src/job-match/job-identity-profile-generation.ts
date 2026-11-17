/**
 * Optional LLM enrichment for Job Matcher V2.5 identity profiles.
 *
 * STUB: nothing calls this in production matching. V2.5 always works from
 * deterministic profiles; a validated LLM profile may later be cached in
 * `JobIdentityProfile` and passed to `resolveV25ProjectIdentity`.
 *
 * Contract: returns a profile that passed `validateJobIdentityProfileAgainstTitle`,
 * or null (client missing, timeout, malformed/invalid output). Callers fall
 * back to `buildDeterministicJobIdentityProfile` on null.
 */

import type OpenAI from "openai";

import {
  buildJsonObjectResponseParams,
  createJsonObjectResponse,
  DEFAULT_CLASSIFICATION_AI_MODEL,
} from "../openai/responses-json.js";
import {
  JOB_IDENTITY_IMPORTANCE_LEVELS,
  JOB_IDENTITY_PROFILE_VERSION,
  JOB_IDENTITY_SEMANTIC_ROLES,
  jobIdentityProfileSourceFingerprint,
  validateJobIdentityProfileAgainstTitle,
  type JobIdentityImportance,
  type JobIdentityProfile,
  type JobIdentityProfileJobInput,
  type JobIdentityProfileTerm,
  type JobIdentitySemanticRole,
  type JobIdentityWorkspaceStats,
} from "@forgeops/shared";

export const JOB_IDENTITY_PROFILE_PROMPT_VERSION =
  "job-identity-profile-prompt-r1" as const;

export const jobIdentityProfileSystemPrompt = `You analyze a construction/steel-fabrication Job title and label which words carry project identity.

Return ONLY JSON:
{
  "terms": [
    {
      "term": string,                 // lowercase word or contiguous phrase copied from the title; descriptor+number as "building:3"
      "role": "DISTINCTIVE_PROJECT_NAME" | "PROJECT_FAMILY_NAME" | "COMPOUND_PROJECT_PHRASE" | "STRUCTURE_DESCRIPTOR" | "GENERIC_CONSTRUCTION_TERM" | "NUMBERED_STRUCTURE_IDENTIFIER" | "SUPPORTING_PROJECT_TERM",
      "semanticImportance": "HIGH" | "MEDIUM" | "LOW" | "NONE"
    }
  ]
}

Rules:
- Only use words that literally appear in the title (or its aliases). Never invent terms.
- A bare number is never an identity term. Numbers count only as descriptor+number ("building:3").
- Generic construction vocabulary (steel, structural, shop, drawings, stairs, rails...) is GENERIC_CONSTRUCTION_TERM with semanticImportance NONE.
- Structure descriptors (building, parking, ramp, garage, phase...) are STRUCTURE_DESCRIPTOR, never project names.
- A distinctive/family project name is the proper-noun-like word(s) that name the project.
- Do not decide how rare a word is across the workspace; that is computed separately.

json`;

export type GenerateJobIdentityProfileInput = {
  client: OpenAI | null;
  model?: string;
  job: JobIdentityProfileJobInput & { jobName: string };
  /** Workspace DF used to fill competitive importance / documentFrequency. */
  workspace: JobIdentityWorkspaceStats;
  timeoutMs?: number;
};

function isRole(v: unknown): v is JobIdentitySemanticRole {
  return (
    typeof v === "string" &&
    (JOB_IDENTITY_SEMANTIC_ROLES as readonly string[]).includes(v)
  );
}

function isImportance(v: unknown): v is JobIdentityImportance {
  return (
    typeof v === "string" &&
    (JOB_IDENTITY_IMPORTANCE_LEVELS as readonly string[]).includes(v)
  );
}

/**
 * LLM-enriched profile, or null on any failure / invalid output.
 * Never throws.
 */
export async function generateJobIdentityProfileWithOpenAI(
  input: GenerateJobIdentityProfileInput
): Promise<JobIdentityProfile | null> {
  if (!input.client) return null;
  const model = input.model ?? DEFAULT_CLASSIFICATION_AI_MODEL;
  const params = buildJsonObjectResponseParams({
    model,
    instructions: jobIdentityProfileSystemPrompt,
    userInput: JSON.stringify({
      title: input.job.jobName,
      aliases: input.job.aliases ?? [],
    }),
    maxOutputTokens: 500,
  });
  try {
    const timeoutMs = input.timeoutMs ?? 12_000;
    const parsed = await Promise.race([
      createJsonObjectResponse(
        input.client,
        params,
        "job_match_identity_profile"
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!parsed || typeof parsed !== "object") return null;
    const rawTerms = (parsed as { terms?: unknown }).terms;
    if (!Array.isArray(rawTerms) || rawTerms.length === 0) return null;

    const terms: JobIdentityProfileTerm[] = [];
    for (const raw of rawTerms) {
      if (!raw || typeof raw !== "object") return null;
      const o = raw as Record<string, unknown>;
      if (typeof o.term !== "string" || !isRole(o.role)) return null;
      const term = o.term.trim().toLowerCase();
      if (!term) return null;
      const df = Math.max(1, input.workspace.documentFrequency.get(term) ?? 1);
      terms.push({
        term,
        tokens: term.includes(":") ? term.split(":") : term.split(/\s+/),
        role: o.role,
        semanticImportance: isImportance(o.semanticImportance)
          ? o.semanticImportance
          : "LOW",
        competitiveImportance:
          o.role === "GENERIC_CONSTRUCTION_TERM"
            ? "NONE"
            : df <= 1
              ? "HIGH"
              : "LOW",
        documentFrequency: df,
        rationale: "LLM-labelled; validated against title.",
      });
    }

    const profile: JobIdentityProfile = {
      profileVersion: JOB_IDENTITY_PROFILE_VERSION,
      jobId: input.job.jobId,
      jobName: input.job.jobName,
      sourceFingerprint: jobIdentityProfileSourceFingerprint(input.job),
      analysisStatus: "READY",
      source: "LLM",
      modelIdentifier: model,
      promptVersion: JOB_IDENTITY_PROFILE_PROMPT_VERSION,
      terms,
    };
    return validateJobIdentityProfileAgainstTitle(profile, input.job).ok
      ? profile
      : null;
  } catch {
    return null;
  }
}
