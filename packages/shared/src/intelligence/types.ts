/**
 * Canonical Intelligence Registry types.
 *
 * The registry describes ForgeOps automated decision systems for discovery,
 * observability, and evaluation. It must NOT re-implement those systems.
 */

/** How the core inference is performed. */
export type IntelligenceType =
  | "AI_LLM"
  | "DETERMINISTIC"
  | "HYBRID"
  | "ML_MODEL"
  | "AGENT";

/** Operational / product status of a registered component. */
export type IntelligenceStatus =
  | "ACTIVE"
  | "SHADOW"
  | "FEATURE_GATED"
  | "EVALUATION_ONLY"
  | "LEGACY"
  | "DISABLED";

/** Quality of available evaluation labels. */
export type GroundTruthQuality = "STRONG" | "MODERATE" | "WEAK" | "NONE";

/** Visual pipeline node kinds for Manage → Intelligence. */
export type IntelligencePipelineNodeKind =
  | "INPUT"
  | "RULE"
  | "MARKER"
  | "MODEL"
  | "TRANSFORM"
  | "VALIDATOR"
  | "DECISION"
  | "OUTPUT"
  | "PERSISTENCE";

export type IntelligencePipelineNode = {
  id: string;
  kind: IntelligencePipelineNodeKind;
  label: string;
  description?: string;
};

export type IntelligencePipelineEdge = {
  from: string;
  to: string;
  /** Optional branch label (e.g. incomplete → LLM). */
  label?: string;
};

export type IntelligencePipeline = {
  nodes: IntelligencePipelineNode[];
  edges: IntelligencePipelineEdge[];
};

/**
 * How instructions can be inspected without duplicating prompt bodies.
 * Server adapters resolve `inspectionKey` to the live prompt/builder.
 */
export type IntelligenceInstructionsMeta =
  | {
      available: true;
      source: "code_module";
      /** Stable keys for server-side prompt inspection adapters. */
      inspectionKeys: string[];
      summary: string;
      editable: false;
    }
  | {
      available: false;
      reason: string;
    };

export type IntelligenceRuleItem = {
  id: string;
  title: string;
  summary: string;
  /** Canonical implementation version string when one exists. */
  version?: string;
};

export type IntelligenceRulesMeta =
  | {
      available: true;
      items: IntelligenceRuleItem[];
      summary: string;
    }
  | {
      available: false;
      reason: string;
    };

export type IntelligenceEvaluationMeta = {
  supported: boolean;
  /** Server-side evaluator id when supported (not client-executable). */
  evaluatorId?: string;
  metrics: string[];
  groundTruthQuality: GroundTruthQuality;
  groundTruthNotes: string;
  /** Why evaluation is unsupported, or caveats when supported. */
  notes: string;
};

export type IntelligenceExplainabilityMeta = {
  available: boolean;
  capabilities: string[];
  notes: string;
};

export type IntelligenceFeatureFlagMeta = {
  envName: string;
  defaultEnabled: boolean;
  effect: string;
};

/**
 * Safe descriptive metadata for one intelligence component.
 * No secrets, no prompt bodies, no executable evaluators.
 */
export type IntelligenceDefinition = {
  id: string;
  name: string;
  description: string;
  type: IntelligenceType;
  status: IntelligenceStatus;
  /**
   * Canonical version identifier(s) from implementation constants.
   * Do not invent fake semver.
   */
  version: string;
  purpose: string;
  /** Conceptual module identifiers (not raw filesystem paths for end users). */
  implementation: {
    packages: string[];
    entryPoints: string[];
  };
  inputs: string;
  outputs: string;
  pipeline: IntelligencePipeline;
  instructions: IntelligenceInstructionsMeta;
  rules: IntelligenceRulesMeta;
  evaluation: IntelligenceEvaluationMeta;
  explainability: IntelligenceExplainabilityMeta;
  featureFlags: IntelligenceFeatureFlagMeta[];
  /**
   * Whether Manage → Intelligence overview should list this component.
   * EVALUATION_ONLY / DISABLED may still register but hide from default overview.
   */
  discoverable: boolean;
};

/** Client-safe DTO — same shape as definition for V1 (already secret-free). */
export type IntelligenceSafeDto = IntelligenceDefinition;
