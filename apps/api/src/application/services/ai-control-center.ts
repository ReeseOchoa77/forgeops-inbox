import type { PrismaClient } from "@prisma/client";
import {
  defaultAiControlSubsystemStates,
  listAiControlSubsystemDefinitions,
  mergeAiControlStates,
  validateAiControlPatch,
  validateSubsystemModel,
  type AiControlConfigPayload,
  type AiControlSubsystemId,
  type AiControlSubsystemState,
} from "@forgeops/shared";

export async function loadAiControlStates(
  prisma: PrismaClient,
  workspaceId: string
): Promise<{
  states: Record<AiControlSubsystemId, AiControlSubsystemState>;
  configVersion: number;
  updatedAt: Date | null;
  updatedByUserId: string | null;
}> {
  const row = await prisma.workspaceAiControlConfig.findUnique({
    where: { workspaceId },
  });
  return {
    states: mergeAiControlStates(row?.subsystems ?? {}),
    configVersion: row?.configVersion ?? 0,
    updatedAt: row?.updatedAt ?? null,
    updatedByUserId: row?.updatedByUserId ?? null,
  };
}

export async function isAiSubsystemEnabled(
  prisma: PrismaClient,
  workspaceId: string,
  subsystemId: AiControlSubsystemId
): Promise<boolean> {
  const { states } = await loadAiControlStates(prisma, workspaceId);
  return states[subsystemId]?.enabled ?? true;
}

export async function getAiSubsystemProductionModelId(
  prisma: PrismaClient,
  workspaceId: string,
  subsystemId: AiControlSubsystemId
): Promise<string> {
  const { states } = await loadAiControlStates(prisma, workspaceId);
  return (
    states[subsystemId]?.productionModelId ??
    defaultAiControlSubsystemStates()[subsystemId].productionModelId
  );
}

export async function getAiControlCenterDto(
  prisma: PrismaClient,
  workspaceId: string
): Promise<{
  config: AiControlConfigPayload;
  definitions: ReturnType<typeof listAiControlSubsystemDefinitions>;
}> {
  const loaded = await loadAiControlStates(prisma, workspaceId);
  return {
    config: {
      configVersion: loaded.configVersion,
      subsystems: loaded.states,
      updatedAt: loaded.updatedAt?.toISOString() ?? null,
      updatedByUserId: loaded.updatedByUserId,
    },
    definitions: listAiControlSubsystemDefinitions(),
  };
}

export async function updateAiControlCenter(input: {
  prisma: PrismaClient;
  workspaceId: string;
  userId: string;
  patch: Record<string, Partial<AiControlSubsystemState>>;
  confirm: boolean;
  expectedConfigVersion?: number | null;
}): Promise<AiControlConfigPayload> {
  if (!input.confirm) {
    throw Object.assign(new Error("Confirmation required for production AI changes"), {
      statusCode: 400,
    });
  }

  const validated = validateAiControlPatch(input.patch);
  if (!validated.ok) {
    throw Object.assign(
      new Error(validated.errors.map((e) => `${e.subsystemId}: ${e.message}`).join("; ")),
      { statusCode: 400, errors: validated.errors }
    );
  }

  // Merge patch onto current stored/default state (not empty defaults only).
  const current = await loadAiControlStates(input.prisma, input.workspaceId);
  if (
    input.expectedConfigVersion != null &&
    current.configVersion !== 0 &&
    input.expectedConfigVersion !== current.configVersion
  ) {
    throw Object.assign(
      new Error(
        `Configuration version conflict (expected ${input.expectedConfigVersion}, found ${current.configVersion}). Reload and retry.`
      ),
      { statusCode: 409 }
    );
  }

  const nextStates = { ...current.states };
  for (const [id, partial] of Object.entries(input.patch)) {
    const key = id as AiControlSubsystemId;
    const enabled =
      typeof partial.enabled === "boolean"
        ? partial.enabled
        : nextStates[key].enabled;
    const productionModelId =
      typeof partial.productionModelId === "string" && partial.productionModelId.trim()
        ? partial.productionModelId.trim()
        : nextStates[key].productionModelId;
    const err = validateSubsystemModel(key, productionModelId);
    if (err) {
      throw Object.assign(new Error(`${err.subsystemId}: ${err.message}`), {
        statusCode: 400,
      });
    }
    nextStates[key] = { enabled, productionModelId };
  }

  const previous = current.states;
  const row = await input.prisma.workspaceAiControlConfig.upsert({
    where: { workspaceId: input.workspaceId },
    create: {
      workspaceId: input.workspaceId,
      configVersion: 1,
      subsystems: nextStates as object,
      updatedByUserId: input.userId,
    },
    update: {
      configVersion: { increment: 1 },
      subsystems: nextStates as object,
      updatedByUserId: input.userId,
    },
  });

  // Keep Lab/legacy intelligence config in sync when JI model changes.
  if (
    input.patch["job-intelligence"]?.productionModelId &&
    nextStates["job-intelligence"].productionModelId !==
      previous["job-intelligence"].productionModelId
  ) {
    await input.prisma.workspaceIntelligenceConfig.upsert({
      where: { workspaceId: input.workspaceId },
      create: {
        workspaceId: input.workspaceId,
        productionIntelligenceModelId:
          nextStates["job-intelligence"].productionModelId,
        updatedByUserId: input.userId,
      },
      update: {
        productionIntelligenceModelId:
          nextStates["job-intelligence"].productionModelId,
        updatedByUserId: input.userId,
      },
    });
  }

  await input.prisma.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      entityType: "JOB",
      entityId: input.workspaceId,
      action: "AI_CONTROL_CENTER_UPDATED",
      metadata: {
        previous,
        next: nextStates,
        configVersion: row.configVersion,
        patch: input.patch,
      },
    },
  });

  return {
    configVersion: row.configVersion,
    subsystems: mergeAiControlStates(row.subsystems),
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
  };
}
