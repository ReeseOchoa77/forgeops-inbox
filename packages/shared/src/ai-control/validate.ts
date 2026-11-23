import {
  isJobIntelligenceExecutableModelId,
} from "../jobs/job-intelligence/model-registry.js";
import { isJobMatchRunnablePolicyId } from "../jobs/job-match-policy-registry.js";
import {
  isAiControlSubsystemId,
  listAiControlSubsystemDefinitions,
  mergeAiControlStates,
  type AiControlSubsystemId,
  type AiControlSubsystemState,
} from "./subsystems.js";

export type AiControlValidationError = {
  subsystemId: string;
  message: string;
};

export function validateSubsystemModel(
  subsystemId: AiControlSubsystemId,
  productionModelId: string
): AiControlValidationError | null {
  const def = listAiControlSubsystemDefinitions().find((d) => d.id === subsystemId);
  if (!def) {
    return { subsystemId, message: "Unknown subsystem" };
  }
  const opt = def.models.find((m) => m.id === productionModelId);
  if (!opt) {
    return { subsystemId, message: `Unknown model ${productionModelId}` };
  }
  if (!opt.selectable || opt.status === "retired") {
    return {
      subsystemId,
      message: `Model ${productionModelId} is not selectable (${opt.status})`,
    };
  }
  if (subsystemId === "job-matcher" && !isJobMatchRunnablePolicyId(productionModelId)) {
    return {
      subsystemId,
      message: `Matcher policy ${productionModelId} is retired or not runnable`,
    };
  }
  if (
    subsystemId === "job-intelligence" &&
    !isJobIntelligenceExecutableModelId(productionModelId)
  ) {
    return {
      subsystemId,
      message: `Intelligence model ${productionModelId} is not executable`,
    };
  }
  return null;
}

export function validateAiControlPatch(
  patch: Record<string, Partial<AiControlSubsystemState>>
): {
  ok: true;
  next: Record<AiControlSubsystemId, AiControlSubsystemState>;
} | {
  ok: false;
  errors: AiControlValidationError[];
} {
  const base = mergeAiControlStates({});
  const errors: AiControlValidationError[] = [];
  const next = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (!isAiControlSubsystemId(key)) {
      errors.push({ subsystemId: key, message: "Unknown subsystem id" });
      continue;
    }
    const enabled =
      typeof value.enabled === "boolean" ? value.enabled : base[key].enabled;
    const productionModelId =
      typeof value.productionModelId === "string" && value.productionModelId.trim()
        ? value.productionModelId.trim()
        : base[key].productionModelId;
    const err = validateSubsystemModel(key, productionModelId);
    if (err) errors.push(err);
    next[key] = { enabled, productionModelId };
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, next };
}
