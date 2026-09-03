import type { Prisma } from "@prisma/client";

/**
 * Provenance for classifier-generated tasks (native pipeline + legacy heuristic).
 * Manual tasks typically have null sourceMessageId and/or non-native keys —
 * they must never match this filter.
 */
export function classifierGeneratedTaskKeyFilter(): Prisma.TaskWhereInput {
  return {
    OR: [
      { sourceTaskKey: { startsWith: "native:" } },
      { sourceTaskKey: "heuristic-primary" },
    ],
  };
}

/** Workspace + source-email scoped classifier-generated tasks. */
export function classifierGeneratedTasksForMessageWhere(input: {
  workspaceId: string;
  sourceMessageId: string;
}): Prisma.TaskWhereInput {
  return {
    workspaceId: input.workspaceId,
    sourceMessageId: input.sourceMessageId,
    ...classifierGeneratedTaskKeyFilter(),
  };
}

export const RECLASSIFY_TASK_MODE_VALUES = [
  "REMOVE_ONLY",
  "REGENERATE",
] as const;

export type ReclassifyTaskMode = (typeof RECLASSIFY_TASK_MODE_VALUES)[number];

export const DEFAULT_RECLASSIFY_TASK_MODE: ReclassifyTaskMode = "REMOVE_ONLY";
