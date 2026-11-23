import type { PrismaClient } from "@prisma/client";
import {
  mergeAiControlStates,
  type AiControlSubsystemId,
  type AiControlSubsystemState,
  isJobMatchRunnablePolicyId,
  type JobMatchRunnablePolicyId,
  getProductionJobMatchIdentityPolicy,
} from "@forgeops/shared";

export async function loadWorkspaceAiControlStates(
  prisma: PrismaClient,
  workspaceId: string
): Promise<Record<AiControlSubsystemId, AiControlSubsystemState>> {
  const row = await prisma.workspaceAiControlConfig.findUnique({
    where: { workspaceId },
    select: { subsystems: true },
  });
  return mergeAiControlStates(row?.subsystems ?? {});
}

export async function isWorkspaceAiSubsystemEnabled(
  prisma: PrismaClient,
  workspaceId: string,
  subsystemId: AiControlSubsystemId
): Promise<boolean> {
  const states = await loadWorkspaceAiControlStates(prisma, workspaceId);
  return states[subsystemId]?.enabled ?? true;
}

export async function resolveJobMatcherGate(
  prisma: PrismaClient,
  workspaceId: string
): Promise<{
  enabled: boolean;
  identityPolicy: JobMatchRunnablePolicyId;
}> {
  const states = await loadWorkspaceAiControlStates(prisma, workspaceId);
  const matcher = states["job-matcher"];
  const raw = matcher.productionModelId;
  const identityPolicy = isJobMatchRunnablePolicyId(raw)
    ? raw
    : getProductionJobMatchIdentityPolicy();
  return { enabled: matcher.enabled, identityPolicy };
}
