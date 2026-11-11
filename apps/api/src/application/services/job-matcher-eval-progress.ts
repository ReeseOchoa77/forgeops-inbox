/**
 * In-memory progress for long Job Matcher evaluations (Manage UI polling).
 * Not durable — cleared on completion/failure/TTL. Workspace-scoped keys only.
 */

export type JobMatcherEvalProgressSnapshot = {
  evaluationRunId: string;
  workspaceId: string;
  status: "running" | "completed" | "failed";
  phase: string;
  emailsTotal: number;
  emailsCompleted: number;
  policiesTotal: number;
  policiesCompleted: number;
  error: string | null;
  updatedAt: number;
};

const STORE = new Map<string, JobMatcherEvalProgressSnapshot>();
const TTL_MS = 60 * 60 * 1000;

function key(workspaceId: string, evaluationRunId: string): string {
  return `${workspaceId}::${evaluationRunId}`;
}

function pruneExpired(now = Date.now()): void {
  for (const [k, snap] of STORE) {
    if (now - snap.updatedAt > TTL_MS) STORE.delete(k);
  }
}

export function startJobMatcherEvalProgress(input: {
  workspaceId: string;
  evaluationRunId: string;
  emailsTotal: number;
  policiesTotal: number;
  phase?: string;
}): JobMatcherEvalProgressSnapshot {
  pruneExpired();
  const snap: JobMatcherEvalProgressSnapshot = {
    evaluationRunId: input.evaluationRunId,
    workspaceId: input.workspaceId,
    status: "running",
    phase: input.phase ?? "starting",
    emailsTotal: input.emailsTotal,
    emailsCompleted: 0,
    policiesTotal: input.policiesTotal,
    policiesCompleted: 0,
    error: null,
    updatedAt: Date.now(),
  };
  STORE.set(key(input.workspaceId, input.evaluationRunId), snap);
  return snap;
}

export function updateJobMatcherEvalProgress(input: {
  workspaceId: string;
  evaluationRunId: string;
  phase?: string;
  emailsCompleted?: number;
  emailsTotal?: number;
  policiesCompleted?: number;
  policiesTotal?: number;
}): void {
  const k = key(input.workspaceId, input.evaluationRunId);
  const cur = STORE.get(k);
  if (!cur || cur.status !== "running") return;
  STORE.set(k, {
    ...cur,
    phase: input.phase ?? cur.phase,
    emailsCompleted: input.emailsCompleted ?? cur.emailsCompleted,
    emailsTotal: input.emailsTotal ?? cur.emailsTotal,
    policiesCompleted: input.policiesCompleted ?? cur.policiesCompleted,
    policiesTotal: input.policiesTotal ?? cur.policiesTotal,
    updatedAt: Date.now(),
  });
}

export function completeJobMatcherEvalProgress(input: {
  workspaceId: string;
  evaluationRunId: string;
}): void {
  const k = key(input.workspaceId, input.evaluationRunId);
  const cur = STORE.get(k);
  if (!cur) return;
  STORE.set(k, {
    ...cur,
    status: "completed",
    phase: "completed",
    emailsCompleted: cur.emailsTotal,
    policiesCompleted: cur.policiesTotal,
    updatedAt: Date.now(),
  });
}

export function failJobMatcherEvalProgress(input: {
  workspaceId: string;
  evaluationRunId: string;
  error: string;
}): void {
  const k = key(input.workspaceId, input.evaluationRunId);
  const cur = STORE.get(k);
  if (!cur) return;
  STORE.set(k, {
    ...cur,
    status: "failed",
    phase: "failed",
    error: input.error,
    updatedAt: Date.now(),
  });
}

export function getJobMatcherEvalProgress(input: {
  workspaceId: string;
  evaluationRunId: string;
}): JobMatcherEvalProgressSnapshot | null {
  pruneExpired();
  return STORE.get(key(input.workspaceId, input.evaluationRunId)) ?? null;
}
