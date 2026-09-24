/**
 * Job assignment provenance helpers for verified project folders.
 */

export const VERIFIED_PROJECT_FOLDER_SOURCE = "VERIFIED_PROJECT_FOLDER" as const;

/** Manual user assignment must never be silently overwritten. */
export function isManualJobAssignment(existing: {
  jobAssignmentIsManual?: boolean | null;
  jobAssignmentSource?: string | null;
}): boolean {
  return Boolean(
    existing.jobAssignmentIsManual ||
      existing.jobAssignmentSource === "USER_ASSIGNED"
  );
}

/**
 * Assignments JobMatcher / weaker sources must not steal.
 * Includes verified project-folder provenance.
 */
export function isProtectedJobAssignment(existing: {
  jobAssignmentIsManual?: boolean | null;
  jobAssignmentSource?: string | null;
}): boolean {
  return (
    isManualJobAssignment(existing) ||
    existing.jobAssignmentSource === VERIFIED_PROJECT_FOLDER_SOURCE
  );
}

export type VerifiedFolderJobAssignOutcome =
  | "assigned"
  | "unchanged"
  | "conflict";

/**
 * Decide whether a VERIFIED folder may set EmailMessage.jobId.
 * - Manual / USER_ASSIGNED with a different job → conflict
 * - Same job already → unchanged
 * - AI / empty / other → assign (override)
 */
export function resolveVerifiedFolderJobAssignment(input: {
  existingJobId: string | null | undefined;
  existingIsManual: boolean;
  existingSource: string | null | undefined;
  folderJobId: string;
}): VerifiedFolderJobAssignOutcome {
  if (input.existingJobId && input.existingJobId === input.folderJobId) {
    return "unchanged";
  }

  if (
    isManualJobAssignment({
      jobAssignmentIsManual: input.existingIsManual,
      jobAssignmentSource: input.existingSource ?? null,
    }) &&
    input.existingJobId
  ) {
    return "conflict";
  }

  return "assigned";
}

export function emptyProjectFolderEmailAnalyzeProgress(): import("../types/jobs.js").ProjectFolderEmailAnalyzeProgress {
  return {
    foldersTotal: 0,
    foldersDone: 0,
    currentFolderName: null,
    processed: 0,
    created: 0,
    existing: 0,
    assigned: 0,
    classifyQueued: 0,
    classifySkipped: 0,
    attachmentQueued: 0,
    conflicts: 0,
    failed: 0,
    unavailable: 0,
  };
}

/**
 * Count each provider message once.
 * Import reports an existing row in both updatedMessageIds and duplicateMessageIds.
 * Adding those lengths together counts the same email twice.
 * A message created and then seen again in the same page counts as created.
 */
export function addProjectFolderMessageOutcomes(
  progress: import("../types/jobs.js").ProjectFolderEmailAnalyzeProgress,
  input: {
    createdMessageIds?: string[] | null | undefined;
    updatedMessageIds?: string[] | null | undefined;
    duplicateMessageIds?: string[] | null | undefined;
  }
): void {
  const created = new Set(input.createdMessageIds ?? []);
  const existing = new Set([
    ...(input.updatedMessageIds ?? []),
    ...(input.duplicateMessageIds ?? []),
  ]);
  for (const id of created) existing.delete(id);
  progress.created += created.size;
  progress.existing += existing.size;
  progress.processed += created.size + existing.size;
}

/**
 * Runs saved before the double-count fix stored
 * processed = created + existing + existing.
 * Show the unique total for that exact shape.
 */
export function displayedProjectFolderAnalyzeProgress<
  T extends { processed: number; created: number; existing: number },
>(progress: T): T {
  const unique = progress.created + progress.existing;
  const doubled = progress.created + progress.existing * 2;
  if (progress.existing > 0 && progress.processed === doubled) {
    return { ...progress, processed: unique };
  }
  return progress;
}
