import { INTELLIGENCE_CATALOG } from "./catalog.js";
import type {
  IntelligenceDefinition,
  IntelligenceSafeDto,
  IntelligenceStatus,
  IntelligenceType,
} from "./types.js";
import {
  assertValidIntelligenceCatalog,
  validateIntelligenceDefinition,
} from "./validate.js";

export const INTELLIGENCE_TYPES: readonly IntelligenceType[] = [
  "AI_LLM",
  "DETERMINISTIC",
  "HYBRID",
  "ML_MODEL",
  "AGENT",
] as const;

export const INTELLIGENCE_STATUSES: readonly IntelligenceStatus[] = [
  "ACTIVE",
  "SHADOW",
  "FEATURE_GATED",
  "EVALUATION_ONLY",
  "LEGACY",
  "DISABLED",
] as const;

/** All registered intelligence components (canonical source). */
export function listIntelligenceDefinitions(): readonly IntelligenceDefinition[] {
  return INTELLIGENCE_CATALOG;
}

/** Components intended for Manage → Intelligence overview cards. */
export function listDiscoverableIntelligence(): readonly IntelligenceDefinition[] {
  return INTELLIGENCE_CATALOG.filter((d) => d.discoverable);
}

export function getIntelligenceDefinition(
  id: string
): IntelligenceDefinition | undefined {
  return INTELLIGENCE_CATALOG.find((d) => d.id === id);
}

/**
 * Client-safe DTO list. Definitions are already free of secrets/prompt bodies;
 * this is the stable serialization boundary for future GET /intelligence APIs.
 */
export function toIntelligenceSafeDto(
  def: IntelligenceDefinition
): IntelligenceSafeDto {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    type: def.type,
    status: def.status,
    version: def.version,
    purpose: def.purpose,
    implementation: {
      packages: [...def.implementation.packages],
      entryPoints: [...def.implementation.entryPoints],
    },
    inputs: def.inputs,
    outputs: def.outputs,
    pipeline: {
      nodes: def.pipeline.nodes.map((n) => ({ ...n })),
      edges: def.pipeline.edges.map((e) => ({ ...e })),
    },
    instructions: { ...def.instructions },
    rules:
      def.rules.available === true
        ? {
            available: true,
            summary: def.rules.summary,
            items: def.rules.items.map((i) => ({ ...i })),
          }
        : { ...def.rules },
    evaluation: { ...def.evaluation },
    explainability: {
      available: def.explainability.available,
      capabilities: [...def.explainability.capabilities],
      notes: def.explainability.notes,
    },
    featureFlags: def.featureFlags.map((f) => ({ ...f })),
    discoverable: def.discoverable,
  };
}

export function listIntelligenceSafeDtos(opts?: {
  discoverableOnly?: boolean;
}): IntelligenceSafeDto[] {
  const source = opts?.discoverableOnly
    ? listDiscoverableIntelligence()
    : listIntelligenceDefinitions();
  return source.map(toIntelligenceSafeDto);
}

/** Fail fast if the catalog is invalid (import-time optional; tests call explicitly). */
export function assertIntelligenceRegistryValid(): void {
  assertValidIntelligenceCatalog(INTELLIGENCE_CATALOG);
}

export { validateIntelligenceDefinition, assertValidIntelligenceCatalog };
