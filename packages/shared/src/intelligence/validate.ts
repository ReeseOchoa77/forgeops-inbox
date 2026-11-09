import type {
  GroundTruthQuality,
  IntelligenceDefinition,
  IntelligencePipelineNodeKind,
  IntelligenceStatus,
  IntelligenceType,
} from "./types.js";

const TYPES = new Set<IntelligenceType>([
  "AI_LLM",
  "DETERMINISTIC",
  "HYBRID",
  "ML_MODEL",
  "AGENT",
]);

const STATUSES = new Set<IntelligenceStatus>([
  "ACTIVE",
  "SHADOW",
  "FEATURE_GATED",
  "EVALUATION_ONLY",
  "LEGACY",
  "DISABLED",
]);

const NODE_KINDS = new Set<IntelligencePipelineNodeKind>([
  "INPUT",
  "RULE",
  "MARKER",
  "MODEL",
  "TRANSFORM",
  "VALIDATOR",
  "DECISION",
  "OUTPUT",
  "PERSISTENCE",
]);

const GROUND_TRUTH = new Set<GroundTruthQuality>([
  "STRONG",
  "MODERATE",
  "WEAK",
  "NONE",
]);

/** Matches secret *keys/values*, not substrings like ALL_TOKENS. */
const SECRETISH =
  /\b(api[_-]?key|secret|password|authorization|credential|database_url|redis_url)\b|(?:oauth|access|refresh)[_-]?token|sk-(?:proj-|live-|test-)?[a-zA-Z0-9]{16,}/i;

export type IntelligenceValidationIssue = {
  id: string;
  message: string;
};

export function validateIntelligenceDefinition(
  def: IntelligenceDefinition
): IntelligenceValidationIssue[] {
  const issues: IntelligenceValidationIssue[] = [];
  const tag = def.id || "(missing-id)";

  if (!def.id?.trim()) issues.push({ id: tag, message: "id is required" });
  if (!/^[a-z][a-z0-9-]*$/.test(def.id)) {
    issues.push({
      id: tag,
      message: "id must be kebab-case (stable machine id)",
    });
  }
  if (!def.name?.trim()) issues.push({ id: tag, message: "name is required" });
  if (!def.description?.trim()) {
    issues.push({ id: tag, message: "description is required" });
  }
  if (!TYPES.has(def.type)) {
    issues.push({ id: tag, message: `invalid type: ${String(def.type)}` });
  }
  if (!STATUSES.has(def.status)) {
    issues.push({ id: tag, message: `invalid status: ${String(def.status)}` });
  }
  if (!def.version?.trim()) {
    issues.push({ id: tag, message: "version is required" });
  }
  if (!def.purpose?.trim()) {
    issues.push({ id: tag, message: "purpose is required" });
  }
  if (!def.inputs?.trim() || !def.outputs?.trim()) {
    issues.push({ id: tag, message: "inputs and outputs are required" });
  }
  if (!def.implementation?.packages?.length || !def.implementation.entryPoints?.length) {
    issues.push({
      id: tag,
      message: "implementation.packages and entryPoints are required",
    });
  }

  const nodeIds = new Set<string>();
  if (!def.pipeline?.nodes?.length) {
    issues.push({ id: tag, message: "pipeline.nodes must be non-empty" });
  } else {
    for (const node of def.pipeline.nodes) {
      if (!node.id || nodeIds.has(node.id)) {
        issues.push({
          id: tag,
          message: `pipeline node id missing or duplicate: ${node.id}`,
        });
      }
      nodeIds.add(node.id);
      if (!NODE_KINDS.has(node.kind)) {
        issues.push({
          id: tag,
          message: `invalid pipeline node kind: ${String(node.kind)}`,
        });
      }
      if (!node.label?.trim()) {
        issues.push({ id: tag, message: `pipeline node ${node.id} needs label` });
      }
    }
  }

  for (const edge of def.pipeline?.edges ?? []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push({
        id: tag,
        message: `pipeline edge references unknown node: ${edge.from} → ${edge.to}`,
      });
    }
  }

  if (def.type === "AI_LLM" || def.type === "HYBRID" || def.type === "AGENT") {
    if (def.instructions.available !== true && def.instructions.available !== false) {
      issues.push({ id: tag, message: "instructions must be explicitly declared" });
    }
    if (
      def.instructions.available === false &&
      def.type === "AI_LLM" &&
      !def.instructions.reason
    ) {
      issues.push({
        id: tag,
        message: "AI_LLM with unavailable instructions needs a reason",
      });
    }
  }

  if (def.type === "DETERMINISTIC" || def.type === "HYBRID") {
    if (def.rules.available !== true && def.rules.available !== false) {
      issues.push({ id: tag, message: "rules must be explicitly declared" });
    }
    if (def.rules.available === false && !def.rules.reason) {
      issues.push({
        id: tag,
        message: "unavailable rules need a reason",
      });
    }
    if (def.rules.available === true && def.rules.items.length === 0) {
      issues.push({
        id: tag,
        message: "rules.available=true requires at least one rule item",
      });
    }
  }

  if (typeof def.evaluation?.supported !== "boolean") {
    issues.push({ id: tag, message: "evaluation.supported must be boolean" });
  } else {
    if (!GROUND_TRUTH.has(def.evaluation.groundTruthQuality)) {
      issues.push({ id: tag, message: "invalid groundTruthQuality" });
    }
    if (!def.evaluation.groundTruthNotes?.trim() || !def.evaluation.notes?.trim()) {
      issues.push({
        id: tag,
        message: "evaluation groundTruthNotes and notes are required",
      });
    }
    if (def.evaluation.supported && !def.evaluation.evaluatorId?.trim()) {
      issues.push({
        id: tag,
        message: "evaluation.supported=true requires evaluatorId",
      });
    }
    if (!Array.isArray(def.evaluation.metrics)) {
      issues.push({ id: tag, message: "evaluation.metrics must be an array" });
    }
  }

  if (typeof def.explainability?.available !== "boolean") {
    issues.push({ id: tag, message: "explainability.available must be boolean" });
  } else if (!def.explainability.notes?.trim()) {
    issues.push({ id: tag, message: "explainability.notes is required" });
  }

  if (typeof def.discoverable !== "boolean") {
    issues.push({ id: tag, message: "discoverable must be boolean" });
  }

  // Soft secret leak check on string fields
  const blob = JSON.stringify(def);
  if (SECRETISH.test(blob)) {
    issues.push({
      id: tag,
      message: "definition appears to contain secret-like keys/values",
    });
  }

  return issues;
}

export function assertValidIntelligenceCatalog(
  catalog: readonly IntelligenceDefinition[]
): void {
  const ids = new Set<string>();
  const all: IntelligenceValidationIssue[] = [];

  for (const def of catalog) {
    if (ids.has(def.id)) {
      all.push({ id: def.id, message: "duplicate intelligence id" });
    }
    ids.add(def.id);
    all.push(...validateIntelligenceDefinition(def));
  }

  if (all.length > 0) {
    const msg = all.map((i) => `${i.id}: ${i.message}`).join("\n");
    throw new Error(`Invalid Intelligence Registry:\n${msg}`);
  }
}
