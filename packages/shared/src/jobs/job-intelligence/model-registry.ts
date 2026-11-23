/**
 * Canonical Job Intelligence model registry — independent from Job Matcher policies.
 * Only implemented models are executable. Retired models remain readable historically.
 */

import {
  JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
  JOB_INTELLIGENCE_SCHEMA_VERSION,
  JOB_INTELLIGENCE_SUMMARY_MODEL_VERSION,
} from "./constants.js";

export type JobIntelligenceModelStatus =
  | "production"
  | "experimental"
  | "retired";

export type JobIntelligenceModelRegistryEntry = {
  id: string;
  displayName: string;
  version: string;
  description: string;
  status: JobIntelligenceModelStatus;
  /** Extraction pipeline version stamp written on events/runs. */
  extractionModelVersion: string;
  schemaVersion: string;
  summaryModelVersion: string;
  /** When true, may be selected for new Lab / production analysis runs. */
  availableForExecution: boolean;
  productionDefault: boolean;
  createdAt: string;
};

/**
 * Implemented Job Intelligence models only.
 * Do not add placeholder entries that cannot execute.
 * Typed with `satisfies` so id literals remain for active/retired unions.
 */
export const JOB_INTELLIGENCE_MODEL_REGISTRY = [
  {
    id: "job-intel-extract-v1",
    displayName: "Job Intelligence Extractor v1",
    version: "1",
    description:
      "Evidence-backed steel fabrication event extraction + structured summary (job-intel-extract-v1).",
    status: "production",
    extractionModelVersion: JOB_INTELLIGENCE_EXTRACTION_MODEL_VERSION,
    schemaVersion: JOB_INTELLIGENCE_SCHEMA_VERSION,
    summaryModelVersion: JOB_INTELLIGENCE_SUMMARY_MODEL_VERSION,
    availableForExecution: true,
    productionDefault: true,
    createdAt: "2026-11-18T00:00:00.000Z",
  },
] as const satisfies readonly JobIntelligenceModelRegistryEntry[];

export type JobIntelligenceModelId =
  (typeof JOB_INTELLIGENCE_MODEL_REGISTRY)[number]["id"];

/**
 * Retired model ids. Empty union (`never`) when none are retired yet —
 * mirrors Job Matcher `JobMatchRetiredPolicyId` pattern.
 */
export type JobIntelligenceRetiredModelId = Extract<
  (typeof JOB_INTELLIGENCE_MODEL_REGISTRY)[number],
  { status: "retired" }
> extends { id: infer I }
  ? I
  : never;

export type JobIntelligenceRunnableModelId = Exclude<
  JobIntelligenceModelId,
  JobIntelligenceRetiredModelId
>;

export type JobIntelligenceExecutableModelId = Extract<
  (typeof JOB_INTELLIGENCE_MODEL_REGISTRY)[number],
  { availableForExecution: true }
>["id"];

export function listExecutableJobIntelligenceModels(): JobIntelligenceModelRegistryEntry[] {
  return JOB_INTELLIGENCE_MODEL_REGISTRY.filter((e) => e.availableForExecution).map(
    (e) => ({ ...e })
  );
}

export function getJobIntelligenceModelRegistryEntry(
  id: string
): JobIntelligenceModelRegistryEntry | undefined {
  return JOB_INTELLIGENCE_MODEL_REGISTRY.find((e) => e.id === id);
}

export function isJobIntelligenceModelId(
  value: string
): value is JobIntelligenceModelId {
  return JOB_INTELLIGENCE_MODEL_REGISTRY.some((e) => e.id === value);
}

export function isJobIntelligenceRunnableModelId(
  value: string
): value is JobIntelligenceRunnableModelId {
  const entry = getJobIntelligenceModelRegistryEntry(value);
  return Boolean(entry && entry.status !== "retired");
}

export function isJobIntelligenceExecutableModelId(
  value: string
): value is JobIntelligenceExecutableModelId {
  const entry = getJobIntelligenceModelRegistryEntry(value);
  return Boolean(entry?.availableForExecution);
}

/** Active production intelligence model (exactly one registry entry). */
export function getProductionJobIntelligenceModelId(): JobIntelligenceExecutableModelId {
  const entry = JOB_INTELLIGENCE_MODEL_REGISTRY.find((e) => e.productionDefault);
  if (entry?.availableForExecution) {
    return entry.id as JobIntelligenceExecutableModelId;
  }
  const fallback = listExecutableJobIntelligenceModels()[0];
  if (!fallback) {
    throw new Error("No executable Job Intelligence model registered");
  }
  return fallback.id as JobIntelligenceExecutableModelId;
}

export function resolveJobIntelligenceModelForExecution(
  requestedId: string | null | undefined
): JobIntelligenceModelRegistryEntry {
  const id = requestedId?.trim() || getProductionJobIntelligenceModelId();
  const entry = getJobIntelligenceModelRegistryEntry(id);
  if (!entry) {
    throw new Error(`Unknown Job Intelligence model: ${id}`);
  }
  if (!entry.availableForExecution || entry.status === "retired") {
    throw new Error(
      `Job Intelligence model ${id} is not available for new runs (${entry.status})`
    );
  }
  return entry;
}

/** Association strategy for Lab runs — independent from intelligence model id. */
export const JOB_INTELLIGENCE_LAB_ASSOCIATION_MODES = [
  /** Use EmailMessage.jobId + eligibility (not a matcher re-prediction). */
  "PRODUCTION_ASSIGNMENTS",
  /** Re-run selected Job Matcher policy in-memory; never write EmailMessage.jobId. */
  "MATCHER_POLICY",
] as const;

export type JobIntelligenceLabAssociationMode =
  (typeof JOB_INTELLIGENCE_LAB_ASSOCIATION_MODES)[number];
