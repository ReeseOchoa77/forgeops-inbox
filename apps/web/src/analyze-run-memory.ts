export type AnalyzeRunProgressView = {
  status: string
  currentFolderName: string | null
  processed: number
  created: number
  existing: number
  assigned: number
  classifyQueued: number
  classifySkipped: number
  conflicts: number
  failed: number
  unavailable: number
  foldersDone: number
  foldersTotal: number
  errorMessage: string | null
}

export type RememberedAnalyzeRun = {
  runId: string
  progress: AnalyzeRunProgressView
}

const memory = new Map<string, RememberedAnalyzeRun>()

export function analyzeRunMemoryKey(workspaceId: string, connectionId: string): string {
  return `${workspaceId}|${connectionId}`
}

export function isAnalyzeRunInProgress(status: string): boolean {
  return status === 'PENDING' || status === 'RUNNING'
}

/** Matches displayedProjectFolderAnalyzeProgress in shared. */
export function displayedAnalyzeEmailCounts<T extends { processed: number; created: number; existing: number }>(
  progress: T
): T {
  const unique = progress.created + progress.existing
  const doubled = progress.created + progress.existing * 2
  if (progress.existing > 0 && progress.processed === doubled) {
    return { ...progress, processed: unique }
  }
  return progress
}

export function rememberAnalyzeRun(
  workspaceId: string,
  connectionId: string,
  run: RememberedAnalyzeRun
): void {
  memory.set(analyzeRunMemoryKey(workspaceId, connectionId), run)
}

export function readRememberedAnalyzeRun(
  workspaceId: string,
  connectionId: string
): RememberedAnalyzeRun | null {
  return memory.get(analyzeRunMemoryKey(workspaceId, connectionId)) ?? null
}

export function clearRememberedAnalyzeRunsForTests(): void {
  memory.clear()
}
