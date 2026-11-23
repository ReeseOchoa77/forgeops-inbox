/**
 * Canonical AI Control Center subsystem catalog.
 * Only real ForgeOps production AI systems — no fictional modules.
 */

import {
  getProductionJobIntelligenceModelId,
  listExecutableJobIntelligenceModels,
} from "../jobs/job-intelligence/model-registry.js";
import {
  getProductionJobMatchIdentityPolicy,
  listEvaluationSelectablePolicies,
} from "../jobs/job-match-policy-registry.js";
import { isJobMatcherAutoAssignEnabled } from "../ai-automation-gates.js";
import { isInlineImageAiAnalyzeEnabled } from "../ai-automation-gates.js";

export const AI_CONTROL_SUBSYSTEM_IDS = [
  "job-matcher",
  "job-intelligence",
  "email-classification",
  "inline-image-relevance",
  "bid-analysis",
] as const;

export type AiControlSubsystemId = (typeof AI_CONTROL_SUBSYSTEM_IDS)[number];

export type AiControlModelOption = {
  id: string;
  displayName: string;
  description: string;
  status: "production" | "experimental" | "retired";
  selectable: boolean;
};

export type AiControlSubsystemDefinition = {
  id: AiControlSubsystemId;
  name: string;
  description: string;
  /** Human-readable dependency notes for the UI. */
  dependencies: string[];
  /** What “disabled” means for this subsystem. */
  disableBehavior: string;
  models: AiControlModelOption[];
};

export type AiControlSubsystemState = {
  enabled: boolean;
  productionModelId: string;
};

export type AiControlConfigPayload = {
  configVersion: number;
  subsystems: Record<AiControlSubsystemId, AiControlSubsystemState>;
  updatedAt: string | null;
  updatedByUserId: string | null;
};

export function listAiControlSubsystemDefinitions(): AiControlSubsystemDefinition[] {
  const matcherModels: AiControlModelOption[] = listEvaluationSelectablePolicies().map(
    (p) => ({
      id: p.id,
      displayName: p.displayName,
      description: p.description,
      status: p.productionDefault
        ? "production"
        : p.experimental
          ? "experimental"
          : "production",
      selectable: true,
    })
  );

  const intelModels: AiControlModelOption[] = listExecutableJobIntelligenceModels().map(
    (m) => ({
      id: m.id,
      displayName: m.displayName,
      description: m.description,
      status: m.status,
      selectable: m.availableForExecution && m.status !== "retired",
    })
  );

  return [
    {
      id: "job-matcher",
      name: "Job Matcher",
      description:
        "Automatic Email → Job association after classification. Human assignments are always preserved.",
      dependencies: [
        "Runs after email classification on native inbox paths.",
        "Job Intelligence can use stored assignments even if matcher is disabled later.",
      ],
      disableBehavior:
        "Emails continue to ingest. Automatic Job matching and AI auto-assign persistence do not run. Existing jobId values and human assignments remain.",
      models: matcherModels,
    },
    {
      id: "job-intelligence",
      name: "Job Intelligence",
      description:
        "Evidence-backed project event extraction and summaries for Jobs.",
      dependencies: [
        "Works best with reliable Job assignments (human or matcher).",
        "Disabling Job Matcher does not erase existing Job Intelligence.",
      ],
      disableBehavior:
        "New analyze/incremental extraction is refused. Existing events and summaries stay readable. Queued runs abort AI extraction at worker start.",
      models: intelModels,
    },
    {
      id: "email-classification",
      name: "Email Classification",
      description:
        "Native mailbox classification (BUSINESS/PERSONAL, subtype, entities, tasks, priority).",
      dependencies: [
        "Only applies to NATIVE ingestion connections.",
        "Job Matcher typically runs after classification when both are enabled.",
      ],
      disableBehavior:
        "Mail sync and storage continue. Native classify jobs are not enqueued; active classify workers skip AI pipeline. Existing classifications remain readable.",
      models: [
        {
          id: "native-openai-pipeline-v1",
          displayName: "Native OpenAI Pipeline v1",
          description: "Production native classification pipeline.",
          status: "production",
          selectable: true,
        },
      ],
    },
    {
      id: "inline-image-relevance",
      name: "Inline Image Relevance",
      description:
        "Optional vision/AI pass to mark stored inline images as relevant, noise, or uncertain.",
      dependencies: ["Requires stored attachments. Manual human corrections remain available."],
      disableBehavior:
        "Analyze enqueue returns paused. Worker skips AI vision when disabled. Stored images and human labels remain.",
      models: [
        {
          id: "inline-image-relevance-v1",
          displayName: "Inline Image Relevance v1",
          description: "Deterministic + optional vision classifier.",
          status: "production",
          selectable: true,
        },
      ],
    },
    {
      id: "bid-analysis",
      name: "Bid / Quote Analysis",
      description:
        "Staging extraction for Bid Invites and Quotes (does not create Jobs).",
      dependencies: ["Operator-initiated analyze runs. Separate from Job Matcher persistence."],
      disableBehavior:
        "New bid-analysis analyze enqueues are refused. Existing staging rows remain.",
      models: [
        {
          id: "bid-email-staging-hybrid-v1",
          displayName: "Bid Email Staging Hybrid v1",
          description: "Deterministic + optional LLM enrichment for bid/quote staging.",
          status: "production",
          selectable: true,
        },
      ],
    },
  ];
}

/**
 * Defaults that preserve current production behavior when no DB config exists.
 * Job Matcher auto-assign remains OFF unless env enables it (historical freeze).
 * Classification / Job Intelligence stay ON. Inline image AI stays OFF.
 */
export function defaultAiControlSubsystemStates(): Record<
  AiControlSubsystemId,
  AiControlSubsystemState
> {
  return {
    "job-matcher": {
      enabled: isJobMatcherAutoAssignEnabled(),
      productionModelId: getProductionJobMatchIdentityPolicy(),
    },
    "job-intelligence": {
      enabled: true,
      productionModelId: getProductionJobIntelligenceModelId(),
    },
    "email-classification": {
      enabled: true,
      productionModelId: "native-openai-pipeline-v1",
    },
    "inline-image-relevance": {
      enabled: isInlineImageAiAnalyzeEnabled(),
      productionModelId: "inline-image-relevance-v1",
    },
    "bid-analysis": {
      enabled: true,
      productionModelId: "bid-email-staging-hybrid-v1",
    },
  };
}

export function isAiControlSubsystemId(
  value: string
): value is AiControlSubsystemId {
  return (AI_CONTROL_SUBSYSTEM_IDS as readonly string[]).includes(value);
}

export function mergeAiControlStates(
  stored: unknown
): Record<AiControlSubsystemId, AiControlSubsystemState> {
  const defaults = defaultAiControlSubsystemStates();
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return defaults;
  }
  const raw = stored as Record<string, unknown>;
  const out = { ...defaults };
  for (const id of AI_CONTROL_SUBSYSTEM_IDS) {
    const row = raw[id];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const enabled =
      typeof r.enabled === "boolean" ? r.enabled : defaults[id].enabled;
    const productionModelId =
      typeof r.productionModelId === "string" && r.productionModelId.trim()
        ? r.productionModelId.trim()
        : defaults[id].productionModelId;
    out[id] = { enabled, productionModelId };
  }
  return out;
}
