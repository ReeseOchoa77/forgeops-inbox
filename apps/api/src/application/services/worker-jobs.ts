import type { PrismaClient } from "@prisma/client";
import {
  QueueNames,
  WORKER_JOB_DEFINITIONS,
  capabilitiesForJob,
  connectionIdFromScheduledSyncJobId,
  displayStateForBull,
  displayedProjectFolderAnalyzeProgress,
  historicalImportJobId,
  buildMailboxReclassifyJobId,
  buildProjectFolderEmailAnalyzeJobId,
  isKnownQueue,
  sanitizeJobData,
  type QueueName,
  type WorkerJobCapabilities,
  type WorkerJobDisplayState,
} from "@forgeops/shared";

const PAGE_SIZE_MAX = 25;
const PER_STATE_LIMIT = 25;
const LONG_RUNNING_MS = 6 * 60 * 60 * 1000;
/** Missing or finished queue work with an open app run is orphaned after this gap. */
export const ORPHAN_PROGRESS_GAP_MS = 2 * 60 * 1000;
const LIVE_BULL_STATES = new Set([
  "active",
  "waiting",
  "waiting-children",
  "prioritized",
  "delayed",
  "paused",
]);
const OPEN_APP_STATES = new Set(["PENDING", "RUNNING", "CANCELLING"]);

const OPEN_AND_DONE = [
  "active",
  "waiting",
  "prioritized",
  "waiting-children",
  "delayed",
  "paused",
  "failed",
  "completed",
] as const;

export class WorkerJobActionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
  }
}

export type WorkerQueueJob = {
  id?: string;
  name: string;
  data: unknown;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  attemptsMade?: number;
  opts?: { attempts?: number };
  failedReason?: string;
  stacktrace?: string[];
  getState: () => Promise<string>;
  remove: () => Promise<void>;
  retry: () => Promise<void>;
};

export type WorkerQueueHandle = {
  getJobCounts: (...types: string[]) => Promise<Record<string, number>>;
  getJobs: (types: string[], start: number, end: number) => Promise<WorkerQueueJob[]>;
  getJob: (id: string) => Promise<WorkerQueueJob | undefined>;
  isPaused: () => Promise<boolean>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  getRepeatableJobs: () => Promise<
    Array<{ key: string; id?: string | null; pattern?: string | null; next?: number | null }>
  >;
};

export type WorkerQueueBundle = {
  name: QueueName;
  queue: WorkerQueueHandle;
};

export type WorkerJobProgress = {
  current: number;
  total: number | null;
  percent: number | null;
  unit: string;
  stage?: string;
};

export type WorkerJobRow = {
  queue: QueueName;
  jobId: string;
  jobName: string;
  displayName: string;
  displayState: WorkerJobDisplayState;
  queueState: string | null;
  runState: string | null;
  workspaceId: string | null;
  resourceLabel: string;
  resourceKind: string;
  resourceId: string | null;
  inboxConnectionId: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  attemptsMade: number;
  maxAttempts: number | null;
  progress: WorkerJobProgress | null;
  origin: string;
  attention: "LONG_RUNNING" | "INCONSISTENT" | null;
  lastProgressAt: string | null;
  /** Redis could not be read. Absence of a job was not confirmed. */
  queueUnreadable: boolean;
  failedReason: string | null;
  capabilities: WorkerJobCapabilities;
  revertReason: string;
};

export type WorkerJobsList = {
  summary: {
    active: number;
    queued: number;
    delayed: number;
    failed: number;
    paused: number;
    completed: number;
  };
  queues: Array<{
    name: QueueName;
    displayName: string;
    paused: boolean;
    counts: WorkerJobsList["summary"];
  }>;
  schedules: Array<{
    queue: QueueName;
    id: string | null;
    pattern: string | null;
    next: number | null;
    connectionId: string | null;
    canDisable: boolean;
  }>;
  jobs: WorkerJobRow[];
  page: number;
  pageSize: number;
  total: number;
  truncated: boolean;
};

type RunSnapshot = {
  status: string;
  progress: WorkerJobProgress | null;
  errorMessage: string | null;
  updatedAt: Date | null;
};

export function applicationRunIsOrphaned(input: {
  appStatus: string | null;
  bullState: string | null;
  lastProgressAt: Date | null;
  now: number;
  queueUnreadable?: boolean;
}): boolean {
  if (input.queueUnreadable) return false;
  if (!input.appStatus || !OPEN_APP_STATES.has(input.appStatus)) return false;
  if (input.bullState && LIVE_BULL_STATES.has(input.bullState)) return false;
  const age = input.lastProgressAt
    ? input.now - input.lastProgressAt.getTime()
    : Number.POSITIVE_INFINITY;
  return age >= ORPHAN_PROGRESS_GAP_MS;
}

function asRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function str(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function durationMs(
  processedOn?: number | null,
  finishedOn?: number | null,
  now = Date.now()
): number | null {
  if (!processedOn) return null;
  return Math.max(0, (finishedOn ?? now) - processedOn);
}

export function jobVisibleInWorkspace(
  jobWorkspaceId: string | null,
  workspaceFilter: string | null
): boolean {
  if (!workspaceFilter) return true;
  return jobWorkspaceId === workspaceFilter;
}

export function matchesWorkerJobSearch(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

function progressOf(
  current: number,
  total: number | null,
  unit: string,
  stage?: string | null
): WorkerJobProgress {
  const percent =
    total != null && total > 0 ? Math.round((current / total) * 1000) / 10 : null;
  return {
    current,
    total,
    percent,
    unit,
    ...(stage ? { stage } : {}),
  };
}

function statesForStatus(status: string): string[] {
  switch (status) {
    case "active":
      return ["active"];
    case "queued":
      return ["waiting", "prioritized", "waiting-children"];
    case "delayed":
      return ["delayed"];
    case "paused":
      return ["paused"];
    case "completed":
      return ["completed"];
    case "failed":
      return ["failed"];
    case "cancelled":
      return ["active", "waiting", "delayed", "paused", "completed", "failed"];
    default:
      return [...OPEN_AND_DONE];
  }
}

function countSummary(counts: Record<string, number>): WorkerJobsList["summary"] {
  const n = (key: string) => counts[key] ?? 0;
  return {
    active: n("active"),
    queued: n("waiting") + n("prioritized") + n("waiting-children"),
    delayed: n("delayed"),
    failed: n("failed"),
    paused: n("paused"),
    completed: n("completed"),
  };
}

function addSummary(a: WorkerJobsList["summary"], b: WorkerJobsList["summary"]): WorkerJobsList["summary"] {
  return {
    active: a.active + b.active,
    queued: a.queued + b.queued,
    delayed: a.delayed + b.delayed,
    failed: a.failed + b.failed,
    paused: a.paused + b.paused,
    completed: a.completed + b.completed,
  };
}

function emptySummary(): WorkerJobsList["summary"] {
  return { active: 0, queued: 0, delayed: 0, failed: 0, paused: 0, completed: 0 };
}

function iso(ms?: number | null): string | null {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function originOf(data: Record<string, unknown>, jobId: string): string {
  const initiated = str(data, "initiatedBy");
  if (initiated) return initiated;
  if (jobId.startsWith("scheduled-sync-") || jobId.startsWith("scheduled-sync:")) return "SCHEDULE";
  return "SYSTEM";
}

function runKey(queue: QueueName, data: Record<string, unknown>): string | null {
  if (queue === QueueNames.MAILBOX_HISTORICAL_IMPORT) return str(data, "importId");
  if (queue === QueueNames.MAILBOX_RECLASSIFY) return str(data, "runId");
  if (queue === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE) return str(data, "runId");
  return null;
}

export function workerQueuesFromServices(services: {
  inboxSyncQueue: WorkerQueueHandle;
  inboxAnalysisQueue: WorkerQueueHandle;
  attachmentIngestQueue: WorkerQueueHandle;
  mailboxHistoricalImportQueue: WorkerQueueHandle;
  mailboxClassifyQueue: WorkerQueueHandle;
  projectFolderEmailAnalyzeQueue: WorkerQueueHandle;
  mailboxReclassifyQueue: WorkerQueueHandle;
}): WorkerQueueBundle[] {
  return [
    { name: QueueNames.INBOX_SYNC, queue: services.inboxSyncQueue },
    { name: QueueNames.INBOX_ANALYSIS, queue: services.inboxAnalysisQueue },
    { name: QueueNames.ATTACHMENT_INGEST, queue: services.attachmentIngestQueue },
    { name: QueueNames.MAILBOX_HISTORICAL_IMPORT, queue: services.mailboxHistoricalImportQueue },
    { name: QueueNames.MAILBOX_CLASSIFY, queue: services.mailboxClassifyQueue },
    { name: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, queue: services.projectFolderEmailAnalyzeQueue },
    { name: QueueNames.MAILBOX_RECLASSIFY, queue: services.mailboxReclassifyQueue },
  ];
}

async function loadRuns(
  prisma: PrismaClient,
  ids: { imports: string[]; reclassifies: string[]; analyzes: string[] }
): Promise<Map<string, RunSnapshot>> {
  const map = new Map<string, RunSnapshot>();
  if (ids.imports.length) {
    const rows = await prisma.mailboxHistoricalImport.findMany({
      where: { id: { in: ids.imports } },
      select: {
        id: true,
        status: true,
        processedCount: true,
        requestedLimit: true,
        errorMessage: true,
        updatedAt: true,
      },
    });
    for (const row of rows) {
      map.set(
        row.id,
        {
          status: row.status,
          errorMessage: row.errorMessage,
          updatedAt: row.updatedAt ?? null,
          progress: progressOf(
            row.processedCount,
            row.requestedLimit > 0 ? row.requestedLimit : null,
            "messages",
            "Importing messages"
          ),
        }
      );
    }
  }
  if (ids.reclassifies.length) {
    const rows = await prisma.mailboxReclassifyRun.findMany({
      where: { id: { in: ids.reclassifies } },
      select: {
        id: true,
        status: true,
        completed: true,
        totalMatched: true,
        taskMode: true,
        errorMessage: true,
        updatedAt: true,
      },
    });
    for (const row of rows) {
      map.set(row.id, {
        status: row.status,
        errorMessage: row.errorMessage,
        updatedAt: row.updatedAt ?? null,
        progress: progressOf(row.completed, row.totalMatched > 0 ? row.totalMatched : null, "emails", row.taskMode),
      });
    }
  }
  if (ids.analyzes.length) {
    const rows = await prisma.projectFolderEmailAnalyzeRun.findMany({
      where: { id: { in: ids.analyzes } },
      select: { id: true, status: true, progress: true, errorMessage: true, updatedAt: true },
    });
    for (const row of rows) {
      const progress = asRecord(row.progress);
      const foldersDone = typeof progress.foldersDone === "number" ? progress.foldersDone : 0;
      const foldersTotal = typeof progress.foldersTotal === "number" ? progress.foldersTotal : 0;
      const created = typeof progress.created === "number" ? progress.created : 0;
      const existing = typeof progress.existing === "number" ? progress.existing : 0;
      const rawProcessed = typeof progress.processed === "number" ? progress.processed : 0;
      const shown = displayedProjectFolderAnalyzeProgress({
        processed: rawProcessed,
        created,
        existing,
      });
      const folderName = typeof progress.currentFolderName === "string" ? progress.currentFolderName : null;
      const stageParts = [
        folderName ? `Processing ${folderName}` : null,
        `${foldersDone}/${foldersTotal} folders completed`,
        `${shown.processed} examined`,
        `${shown.created} new`,
        `${shown.existing} existing`,
      ].filter((part): part is string => Boolean(part));
      map.set(row.id, {
        status: row.status,
        errorMessage: row.errorMessage,
        updatedAt: row.updatedAt ?? null,
        progress: progressOf(
          foldersDone,
          foldersTotal > 0 ? foldersTotal : null,
          "folders",
          stageParts.join(" · ")
        ),
      });
    }
  }
  return map;
}

function resourceOf(
  queue: QueueName,
  data: Record<string, unknown>,
  mailboxEmail: string | null
): { label: string; kind: string; id: string | null } {
  const emailId = str(data, "emailMessageId");
  const importId = str(data, "importId");
  const runId = str(data, "runId");
  const connectionId = str(data, "inboxConnectionId");
  if (mailboxEmail) {
    return { label: mailboxEmail, kind: "mailbox", id: connectionId };
  }
  if (emailId) return { label: `Email ${emailId.slice(0, 8)}`, kind: "email", id: emailId };
  if (importId) return { label: `Import ${importId.slice(0, 8)}`, kind: "import", id: importId };
  if (runId && queue === QueueNames.MAILBOX_RECLASSIFY) {
    return { label: `Reclassify ${runId.slice(0, 8)}`, kind: "reclassify", id: runId };
  }
  if (runId) return { label: `Analysis ${runId.slice(0, 8)}`, kind: "folder-analysis", id: runId };
  return { label: "System", kind: "system", id: null };
}

function toRow(input: {
  queue: QueueName;
  jobId: string;
  jobName: string;
  bullState: string | null;
  data: Record<string, unknown>;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  attemptsMade?: number;
  maxAttempts?: number;
  failedReason?: string | null;
  run: RunSnapshot | null;
  mailboxEmail: string | null;
  now: number;
  missingJob?: boolean;
  queueUnreadable?: boolean;
}): WorkerJobRow {
  const def = WORKER_JOB_DEFINITIONS[input.queue];
  const runState = input.run?.status ?? null;
  const queueState = input.bullState;
  const queueUnreadable = input.queueUnreadable === true;
  const lastProgressAt = input.run?.updatedAt ?? null;
  let displayState = input.missingJob
    ? "STALE"
    : displayStateForBull(queueState ?? "unknown", runState);
  const orphaned = applicationRunIsOrphaned({
    appStatus: runState,
    bullState: input.missingJob ? null : queueState,
    lastProgressAt,
    now: input.now,
    queueUnreadable,
  });
  let attention: WorkerJobRow["attention"] = orphaned ? "INCONSISTENT" : null;
  if (orphaned) displayState = "STALE";
  if (
    !orphaned &&
    queueState === "active" &&
    input.processedOn &&
    input.now - input.processedOn > LONG_RUNNING_MS
  ) {
    attention = "LONG_RUNNING";
  }
  const resource = resourceOf(input.queue, input.data, input.mailboxEmail);
  const failed = input.failedReason ?? input.run?.errorMessage ?? null;
  return {
    queue: input.queue,
    jobId: input.jobId,
    jobName: input.jobName,
    displayName: def.displayName,
    displayState,
    queueState,
    runState,
    workspaceId: str(input.data, "workspaceId"),
    resourceLabel: resource.label,
    resourceKind: resource.kind,
    resourceId: resource.id,
    inboxConnectionId: str(input.data, "inboxConnectionId"),
    queuedAt: iso(input.timestamp),
    startedAt: iso(input.processedOn),
    finishedAt: iso(input.finishedOn),
    durationMs: durationMs(input.processedOn, input.finishedOn, input.now),
    attemptsMade: input.attemptsMade ?? 0,
    maxAttempts: input.maxAttempts ?? null,
    progress: input.run?.progress ?? null,
    origin: originOf(input.data, input.jobId),
    attention,
    lastProgressAt: lastProgressAt ? lastProgressAt.toISOString() : null,
    queueUnreadable,
    failedReason: failed ? failed.slice(0, 300) : null,
    capabilities: capabilitiesForJob({
      queue: input.queue,
      bullState: input.queueUnreadable ? "unknown" : (input.bullState ?? "missing"),
      ...(runState ? { runStatus: runState } : {}),
    }),
    revertReason: def.revertReason,
  };
}

async function readQueue<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> {
  try {
    return { value: await fn(), failed: false };
  } catch (error) {
    console.warn("worker-jobs-queue-read-failed", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });
    return { value: fallback, failed: true };
  }
}

export async function listWorkerJobs(
  deps: {
    queues: WorkerQueueBundle[];
    prisma: PrismaClient;
  },
  query: {
    status?: string;
    queue?: string;
    q?: string;
    workspaceId?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<WorkerJobsList> {
  const status = query.status?.trim() || "all";
  const queueFilter = query.queue?.trim() || "";
  const search = query.q?.trim() || "";
  const workspaceFilter = query.workspaceId?.trim() || "";
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, query.pageSize ?? PAGE_SIZE_MAX));
  const states = statesForStatus(status);
  const selected = deps.queues.filter((entry) => !queueFilter || entry.name === queueFilter);
  const now = Date.now();

  let summary = emptySummary();
  const queueSummaries: WorkerJobsList["queues"] = [];
  const collected: Array<{ queue: QueueName; state: string; job: WorkerQueueJob }> = [];
  let truncated = false;

  for (const entry of deps.queues) {
    const countsRead = await readQueue(
      `${entry.name}:counts`,
      () =>
        entry.queue.getJobCounts(
          "active",
          "waiting",
          "prioritized",
          "waiting-children",
          "delayed",
          "paused",
          "failed",
          "completed"
        ),
      {}
    );
    const pausedRead = await readQueue(`${entry.name}:paused`, () => entry.queue.isPaused(), false);
    const counts = countSummary(countsRead.value);
    summary = addSummary(summary, counts);
    queueSummaries.push({
      name: entry.name,
      displayName: WORKER_JOB_DEFINITIONS[entry.name].displayName,
      paused: pausedRead.value,
      counts,
    });
  }

  for (const entry of selected) {
    for (const state of states) {
      const jobsRead = await readQueue(
        `${entry.name}:${state}`,
        () => entry.queue.getJobs([state], 0, PER_STATE_LIMIT - 1),
        [] as WorkerQueueJob[]
      );
      const jobs = jobsRead.value;
      if (jobs.length >= PER_STATE_LIMIT) truncated = true;
      for (const job of jobs) {
        if (!job.id) continue;
        collected.push({ queue: entry.name, state, job });
      }
    }
  }

  const importIds: string[] = [];
  const reclassifyIds: string[] = [];
  const analyzeIds: string[] = [];
  for (const item of collected) {
    const id = runKey(item.queue, asRecord(item.job.data));
    if (!id) continue;
    if (item.queue === QueueNames.MAILBOX_HISTORICAL_IMPORT) importIds.push(id);
    if (item.queue === QueueNames.MAILBOX_RECLASSIFY) reclassifyIds.push(id);
    if (item.queue === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE) analyzeIds.push(id);
  }

  const wantStale = status === "all" || status === "active" || status === "cancelled";
  const knownJobs = new Set(collected.map((item) => `${item.queue}:${item.job.id}`));
  const stale: WorkerJobRow[] = [];
  if (wantStale && (!queueFilter || queueFilter === QueueNames.MAILBOX_HISTORICAL_IMPORT)) {
    const running = await deps.prisma.mailboxHistoricalImport.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      take: 15,
      orderBy: { updatedAt: "desc" },
      select: { id: true, workspaceId: true, inboxConnectionId: true },
    });
    const historical = selected.find((entry) => entry.name === QueueNames.MAILBOX_HISTORICAL_IMPORT);
    for (const run of running) {
      const jobId = historicalImportJobId(run.id);
      if (knownJobs.has(`${QueueNames.MAILBOX_HISTORICAL_IMPORT}:${jobId}`)) continue;
      const lookedUp = historical
        ? await readQueue(
            `${QueueNames.MAILBOX_HISTORICAL_IMPORT}:${jobId}`,
            () => historical.queue.getJob(jobId),
            undefined as WorkerQueueJob | undefined
          )
        : { value: undefined as WorkerQueueJob | undefined, failed: false };
      if (lookedUp.value?.id) {
        const stateRead = await readQueue(
          `${jobId}:state`,
          () => lookedUp.value!.getState(),
          "unknown"
        );
        collected.push({
          queue: QueueNames.MAILBOX_HISTORICAL_IMPORT,
          state: stateRead.value,
          job: lookedUp.value,
        });
        importIds.push(run.id);
        continue;
      }
      importIds.push(run.id);
      stale.push(
        toRow({
          queue: QueueNames.MAILBOX_HISTORICAL_IMPORT,
          jobId,
          jobName: QueueNames.MAILBOX_HISTORICAL_IMPORT,
          bullState: null,
          data: { workspaceId: run.workspaceId, inboxConnectionId: run.inboxConnectionId, importId: run.id },
          run: null,
          mailboxEmail: null,
          now,
          missingJob: !lookedUp.failed,
          queueUnreadable: lookedUp.failed,
        })
      );
    }
  }
  if (wantStale && (!queueFilter || queueFilter === QueueNames.MAILBOX_RECLASSIFY)) {
    const running = await deps.prisma.mailboxReclassifyRun.findMany({
      where: { status: { in: ["PENDING", "RUNNING", "CANCELLING"] } },
      take: 15,
      orderBy: { updatedAt: "desc" },
      select: { id: true, workspaceId: true, inboxConnectionId: true },
    });
    const reclassify = selected.find((entry) => entry.name === QueueNames.MAILBOX_RECLASSIFY);
    for (const run of running) {
      const jobId = buildMailboxReclassifyJobId(run.id);
      if (knownJobs.has(`${QueueNames.MAILBOX_RECLASSIFY}:${jobId}`)) continue;
      const lookedUp = reclassify
        ? await readQueue(
            `${QueueNames.MAILBOX_RECLASSIFY}:${jobId}`,
            () => reclassify.queue.getJob(jobId),
            undefined as WorkerQueueJob | undefined
          )
        : { value: undefined as WorkerQueueJob | undefined, failed: false };
      if (lookedUp.value?.id) {
        const stateRead = await readQueue(`${jobId}:state`, () => lookedUp.value!.getState(), "unknown");
        collected.push({
          queue: QueueNames.MAILBOX_RECLASSIFY,
          state: stateRead.value,
          job: lookedUp.value,
        });
        reclassifyIds.push(run.id);
        continue;
      }
      reclassifyIds.push(run.id);
      stale.push(
        toRow({
          queue: QueueNames.MAILBOX_RECLASSIFY,
          jobId,
          jobName: QueueNames.MAILBOX_RECLASSIFY,
          bullState: null,
          data: { workspaceId: run.workspaceId, inboxConnectionId: run.inboxConnectionId, runId: run.id },
          run: null,
          mailboxEmail: null,
          now,
          missingJob: !lookedUp.failed,
          queueUnreadable: lookedUp.failed,
        })
      );
    }
  }
  if (wantStale && (!queueFilter || queueFilter === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE)) {
    const running = await deps.prisma.projectFolderEmailAnalyzeRun.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      take: 15,
      orderBy: { updatedAt: "desc" },
      select: { id: true, workspaceId: true, inboxConnectionId: true },
    });
    const analyze = selected.find((entry) => entry.name === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE);
    for (const run of running) {
      const jobId = buildProjectFolderEmailAnalyzeJobId(run.id);
      if (knownJobs.has(`${QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE}:${jobId}`)) continue;
      const lookedUp = analyze
        ? await readQueue(
            `${QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE}:${jobId}`,
            () => analyze.queue.getJob(jobId),
            undefined as WorkerQueueJob | undefined
          )
        : { value: undefined as WorkerQueueJob | undefined, failed: false };
      if (lookedUp.value?.id) {
        const stateRead = await readQueue(`${jobId}:state`, () => lookedUp.value!.getState(), "unknown");
        collected.push({
          queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
          state: stateRead.value,
          job: lookedUp.value,
        });
        analyzeIds.push(run.id);
        continue;
      }
      analyzeIds.push(run.id);
      stale.push(
        toRow({
          queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
          jobId,
          jobName: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
          bullState: null,
          data: { workspaceId: run.workspaceId, inboxConnectionId: run.inboxConnectionId, runId: run.id },
          run: null,
          mailboxEmail: null,
          now,
          missingJob: !lookedUp.failed,
          queueUnreadable: lookedUp.failed,
        })
      );
    }
  }

  const runs = await loadRuns(deps.prisma, {
    imports: [...new Set(importIds)].slice(0, 100),
    reclassifies: [...new Set(reclassifyIds)].slice(0, 100),
    analyzes: [...new Set(analyzeIds)].slice(0, 100),
  });

  const connectionIds = new Set<string>();
  for (const item of collected) {
    const id = str(asRecord(item.job.data), "inboxConnectionId");
    if (id) connectionIds.add(id);
  }
  for (const row of stale) {
    if (row.inboxConnectionId) connectionIds.add(row.inboxConnectionId);
  }
  const mailboxes =
    connectionIds.size === 0
      ? []
      : await deps.prisma.inboxConnection.findMany({
          where: { id: { in: [...connectionIds] } },
          select: { id: true, email: true },
        });
  const emailById = new Map(mailboxes.map((row) => [row.id, row.email]));

  const rows: WorkerJobRow[] = collected.map((item) => {
    const data = asRecord(item.job.data);
    const key = runKey(item.queue, data);
    const connectionId = str(data, "inboxConnectionId");
    return toRow({
      queue: item.queue,
      jobId: item.job.id ?? "",
      jobName: item.job.name,
      bullState: item.state,
      data,
      ...(item.job.timestamp != null ? { timestamp: item.job.timestamp } : {}),
      ...(item.job.processedOn != null ? { processedOn: item.job.processedOn } : {}),
      ...(item.job.finishedOn != null ? { finishedOn: item.job.finishedOn } : {}),
      attemptsMade: item.job.attemptsMade ?? 0,
      ...(item.job.opts?.attempts != null ? { maxAttempts: item.job.opts.attempts } : {}),
      failedReason: item.job.failedReason ?? null,
      run: key ? runs.get(key) ?? null : null,
      mailboxEmail: connectionId ? emailById.get(connectionId) ?? null : null,
      now,
    });
  });

  for (const row of stale) {
    const snapshot = row.resourceId ? runs.get(row.resourceId) ?? null : null;
    const lastProgressAt = snapshot?.updatedAt ?? null;
    const runStatus = snapshot?.status ?? row.runState;
    const orphaned = applicationRunIsOrphaned({
      appStatus: snapshot?.status ?? row.runState,
      bullState: row.queueState,
      lastProgressAt,
      now,
      queueUnreadable: row.queueUnreadable,
    });
    rows.push({
      ...row,
      ...(snapshot
        ? {
            runState: snapshot.status,
            progress: snapshot.progress,
            failedReason: snapshot.errorMessage?.slice(0, 300) ?? row.failedReason,
          }
        : {}),
      lastProgressAt: lastProgressAt ? lastProgressAt.toISOString() : null,
      displayState: orphaned ? "STALE" : row.displayState,
      attention: orphaned ? "INCONSISTENT" : row.queueUnreadable ? null : row.attention,
      capabilities: capabilitiesForJob({
        queue: row.queue,
        bullState: row.queueUnreadable ? "unknown" : (row.queueState ?? "missing"),
        ...(runStatus ? { runStatus } : {}),
      }),
      resourceLabel: row.inboxConnectionId
        ? emailById.get(row.inboxConnectionId) ?? row.resourceLabel
        : row.resourceLabel,
    });
  }

  const filtered = rows.filter((row) => {
    if (!jobVisibleInWorkspace(row.workspaceId, workspaceFilter || null)) return false;
    if (status === "cancelled" && row.displayState !== "CANCELLED" && row.displayState !== "CANCELLING") {
      return false;
    }
    if (status === "active" && row.displayState !== "ACTIVE" && row.displayState !== "STALE" && row.displayState !== "CANCELLING") {
      return false;
    }
    const haystack = [
      row.jobId,
      row.jobName,
      row.displayName,
      row.queue,
      row.resourceLabel,
      row.resourceId ?? "",
      row.workspaceId ?? "",
      row.inboxConnectionId ?? "",
    ].join(" ");
    return matchesWorkerJobSearch(haystack, search);
  });

  filtered.sort((a, b) => {
    const at = a.queuedAt ? Date.parse(a.queuedAt) : 0;
    const bt = b.queuedAt ? Date.parse(b.queuedAt) : 0;
    return bt - at;
  });

  const start = (page - 1) * pageSize;
  const schedules = await loadSchedules(deps.queues);

  return {
    summary,
    queues: queueSummaries,
    schedules,
    jobs: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total: filtered.length,
    truncated,
  };
}

async function loadSchedules(queues: WorkerQueueBundle[]): Promise<WorkerJobsList["schedules"]> {
  const sync = queues.find((entry) => entry.name === QueueNames.INBOX_SYNC);
  if (!sync) return [];
  const jobs = await sync.queue.getRepeatableJobs();
  return jobs.slice(0, 50).map((job) => {
    const connectionId = job.id ? connectionIdFromScheduledSyncJobId(job.id) : null;
    return {
      queue: QueueNames.INBOX_SYNC,
      id: job.id ?? null,
      pattern: job.pattern ?? null,
      next: job.next ?? null,
      connectionId,
      canDisable: Boolean(connectionId),
    };
  });
}

async function detailForMissingApplicationJob(
  prisma: PrismaClient,
  queueName: QueueName,
  jobId: string
): Promise<{
  job: WorkerJobRow;
  payload: unknown;
  stack: string[];
  queuePaused: boolean;
} | null> {
  const now = Date.now();
  if (queueName === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE && jobId.startsWith("project-folder-email-analyze-")) {
    const runId = jobId.slice("project-folder-email-analyze-".length);
    const run = await prisma.projectFolderEmailAnalyzeRun.findUnique({
      where: { id: runId },
      select: { id: true, workspaceId: true, inboxConnectionId: true },
    });
    if (!run) return null;
    const runs = await loadRuns(prisma, { imports: [], reclassifies: [], analyzes: [run.id] });
    const data = { workspaceId: run.workspaceId, inboxConnectionId: run.inboxConnectionId, runId: run.id };
    return {
      job: toRow({
        queue: queueName,
        jobId,
        jobName: queueName,
        bullState: null,
        data,
        run: runs.get(run.id) ?? null,
        mailboxEmail: null,
        now,
        missingJob: true,
      }),
      payload: sanitizeJobData(data),
      stack: [],
      queuePaused: false,
    };
  }
  if (queueName === QueueNames.MAILBOX_HISTORICAL_IMPORT && jobId.startsWith("historical-import-")) {
    const importId = jobId.slice("historical-import-".length);
    const row = await prisma.mailboxHistoricalImport.findUnique({
      where: { id: importId },
      select: { id: true, workspaceId: true, inboxConnectionId: true },
    });
    if (!row) return null;
    const runs = await loadRuns(prisma, { imports: [row.id], reclassifies: [], analyzes: [] });
    const data = { workspaceId: row.workspaceId, inboxConnectionId: row.inboxConnectionId, importId: row.id };
    return {
      job: toRow({
        queue: queueName,
        jobId,
        jobName: queueName,
        bullState: null,
        data,
        run: runs.get(row.id) ?? null,
        mailboxEmail: null,
        now,
        missingJob: true,
      }),
      payload: sanitizeJobData(data),
      stack: [],
      queuePaused: false,
    };
  }
  if (queueName === QueueNames.MAILBOX_RECLASSIFY && jobId.startsWith("mailbox-reclassify-")) {
    const runId = jobId.slice("mailbox-reclassify-".length);
    const row = await prisma.mailboxReclassifyRun.findUnique({
      where: { id: runId },
      select: { id: true, workspaceId: true, inboxConnectionId: true },
    });
    if (!row) return null;
    const runs = await loadRuns(prisma, { imports: [], reclassifies: [row.id], analyzes: [] });
    const data = { workspaceId: row.workspaceId, inboxConnectionId: row.inboxConnectionId, runId: row.id };
    return {
      job: toRow({
        queue: queueName,
        jobId,
        jobName: queueName,
        bullState: null,
        data,
        run: runs.get(row.id) ?? null,
        mailboxEmail: null,
        now,
        missingJob: true,
      }),
      payload: sanitizeJobData(data),
      stack: [],
      queuePaused: false,
    };
  }
  return null;
}

export async function getWorkerJobDetail(
  deps: { queues: WorkerQueueBundle[]; prisma: PrismaClient },
  queueName: string,
  jobId: string
): Promise<{
  job: WorkerJobRow;
  payload: unknown;
  stack: string[];
  queuePaused: boolean;
} | null> {
  if (!isKnownQueue(queueName)) return null;
  const entry = deps.queues.find((item) => item.name === queueName);
  if (!entry) return null;
  const job = await entry.queue.getJob(jobId).catch(() => undefined);
  if (!job?.id) {
    return detailForMissingApplicationJob(deps.prisma, queueName, jobId);
  }
  const data = asRecord(job.data);
  const key = runKey(queueName, data);
  const runs = await loadRuns(deps.prisma, {
    imports: queueName === QueueNames.MAILBOX_HISTORICAL_IMPORT && key ? [key] : [],
    reclassifies: queueName === QueueNames.MAILBOX_RECLASSIFY && key ? [key] : [],
    analyzes: queueName === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE && key ? [key] : [],
  });
  const connectionId = str(data, "inboxConnectionId");
  const mailbox = connectionId
    ? await deps.prisma.inboxConnection.findUnique({
        where: { id: connectionId },
        select: { email: true },
      })
    : null;
  const state = await job.getState();
  const row = toRow({
    queue: queueName,
    jobId: job.id,
    jobName: job.name,
    bullState: state,
    data,
    ...(job.timestamp != null ? { timestamp: job.timestamp } : {}),
    ...(job.processedOn != null ? { processedOn: job.processedOn } : {}),
    ...(job.finishedOn != null ? { finishedOn: job.finishedOn } : {}),
    attemptsMade: job.attemptsMade ?? 0,
    ...(job.opts?.attempts != null ? { maxAttempts: job.opts.attempts } : {}),
    failedReason: job.failedReason ?? null,
    run: key ? runs.get(key) ?? null : null,
    mailboxEmail: mailbox?.email ?? null,
    now: Date.now(),
  });
  const stack = (job.stacktrace ?? []).slice(0, 30).map((line) => line.slice(0, 300));
  return {
    job: row,
    payload: sanitizeJobData(job.data),
    stack,
    queuePaused: await entry.queue.isPaused(),
  };
}

function bundle(queues: WorkerQueueBundle[], queueName: string): WorkerQueueBundle {
  if (!isKnownQueue(queueName)) {
    throw new WorkerJobActionError("Unknown queue", 404, "UNKNOWN_QUEUE");
  }
  const entry = queues.find((item) => item.name === queueName);
  if (!entry) throw new WorkerJobActionError("Queue is not registered", 404, "UNKNOWN_QUEUE");
  return entry;
}

async function requireJob(entry: WorkerQueueBundle, jobId: string): Promise<WorkerQueueJob> {
  const job = await entry.queue.getJob(jobId);
  if (!job?.id) throw new WorkerJobActionError("Job not found", 404, "JOB_NOT_FOUND");
  return job;
}

export async function retryWorkerJob(
  deps: { queues: WorkerQueueBundle[] },
  queueName: string,
  jobId: string
): Promise<{ queue: QueueName; jobId: string; workspaceId: string | null }> {
  const entry = bundle(deps.queues, queueName);
  const job = await requireJob(entry, jobId);
  const state = await job.getState();
  const caps = capabilitiesForJob({ queue: entry.name, bullState: state });
  if (!caps.retry) {
    throw new WorkerJobActionError("Only a failed job can be retried", 409, "RETRY_UNAVAILABLE");
  }
  await job.retry();
  return {
    queue: entry.name,
    jobId: job.id!,
    workspaceId: str(asRecord(job.data), "workspaceId"),
  };
}

export async function removeWorkerJob(
  deps: { queues: WorkerQueueBundle[] },
  queueName: string,
  jobId: string
): Promise<{ queue: QueueName; jobId: string; workspaceId: string | null }> {
  const entry = bundle(deps.queues, queueName);
  const job = await requireJob(entry, jobId);
  const state = await job.getState();
  const caps = capabilitiesForJob({ queue: entry.name, bullState: state });
  if (!caps.remove) {
    throw new WorkerJobActionError(
      "This job is still running. Cancel it first. Removing a queue record does not stop execution or undo saved data.",
      409,
      "REMOVE_UNAVAILABLE"
    );
  }
  const workspaceId = str(asRecord(job.data), "workspaceId");
  await job.remove();
  return { queue: entry.name, jobId: job.id!, workspaceId };
}

const ABORT_MESSAGE = "Aborted from Worker Jobs. Mail already saved stays saved.";

async function abortProjectFolderRun(prisma: PrismaClient, runId: string): Promise<number> {
  const updated = await prisma.projectFolderEmailAnalyzeRun.updateMany({
    where: { id: runId, status: { in: ["PENDING", "RUNNING"] } },
    data: {
      status: "CANCELLED",
      errorMessage: ABORT_MESSAGE,
      completedAt: new Date(),
    },
  });
  return updated.count;
}

async function abortMissingApplicationRun(
  prisma: PrismaClient,
  queueName: QueueName,
  jobId: string
): Promise<{ queue: QueueName; jobId: string; workspaceId: string | null; mode: "closed" }> {
  if (queueName === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE && jobId.startsWith("project-folder-email-analyze-")) {
    const runId = jobId.slice("project-folder-email-analyze-".length);
    const count = await abortProjectFolderRun(prisma, runId);
    if (count === 0) {
      throw new WorkerJobActionError("This analysis is not running", 409, "CANCEL_UNAVAILABLE");
    }
    const run = await prisma.projectFolderEmailAnalyzeRun.findUnique({
      where: { id: runId },
      select: { workspaceId: true },
    });
    return { queue: queueName, jobId, workspaceId: run?.workspaceId ?? null, mode: "closed" };
  }
  if (queueName === QueueNames.MAILBOX_HISTORICAL_IMPORT && jobId.startsWith("historical-import-")) {
    const importId = jobId.slice("historical-import-".length);
    const updated = await prisma.mailboxHistoricalImport.updateMany({
      where: { id: importId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED", completedAt: new Date(), errorMessage: ABORT_MESSAGE },
    });
    if (updated.count === 0) {
      throw new WorkerJobActionError("This import is not running", 409, "CANCEL_UNAVAILABLE");
    }
    const row = await prisma.mailboxHistoricalImport.findUnique({
      where: { id: importId },
      select: { workspaceId: true },
    });
    return { queue: queueName, jobId, workspaceId: row?.workspaceId ?? null, mode: "closed" };
  }
  if (queueName === QueueNames.MAILBOX_RECLASSIFY && jobId.startsWith("mailbox-reclassify-")) {
    const runId = jobId.slice("mailbox-reclassify-".length);
    const updated = await prisma.mailboxReclassifyRun.updateMany({
      where: { id: runId, status: { in: ["PENDING", "RUNNING", "CANCELLING"] } },
      data: { status: "CANCELLED", completedAt: new Date(), errorMessage: ABORT_MESSAGE },
    });
    if (updated.count === 0) {
      throw new WorkerJobActionError("This run is not running", 409, "CANCEL_UNAVAILABLE");
    }
    const row = await prisma.mailboxReclassifyRun.findUnique({
      where: { id: runId },
      select: { workspaceId: true },
    });
    return { queue: queueName, jobId, workspaceId: row?.workspaceId ?? null, mode: "closed" };
  }
  throw new WorkerJobActionError("Job not found", 404, "JOB_NOT_FOUND");
}

export async function cancelWorkerJob(
  deps: { queues: WorkerQueueBundle[]; prisma: PrismaClient },
  queueName: string,
  jobId: string
): Promise<{ queue: QueueName; jobId: string; workspaceId: string | null; mode: "removed" | "cooperative" | "closed" }> {
  const entry = bundle(deps.queues, queueName);
  const job = await entry.queue.getJob(jobId);
  if (!job?.id) {
    return abortMissingApplicationRun(deps.prisma, entry.name, jobId);
  }
  const state = await job.getState();
  const data = asRecord(job.data);
  const workspaceId = str(data, "workspaceId");
  const waiting =
    state === "waiting" ||
    state === "delayed" ||
    state === "paused" ||
    state === "prioritized" ||
    state === "waiting-children";

  if (waiting) {
    if (entry.name === QueueNames.MAILBOX_HISTORICAL_IMPORT) {
      const importId = str(data, "importId");
      if (importId) {
        await deps.prisma.mailboxHistoricalImport.updateMany({
          where: { id: importId, status: { in: ["PENDING", "RUNNING"] } },
          data: { status: "CANCELLED", completedAt: new Date() },
        });
      }
    }
    if (entry.name === QueueNames.MAILBOX_RECLASSIFY) {
      const runId = str(data, "runId");
      if (runId) {
        await deps.prisma.mailboxReclassifyRun.updateMany({
          where: { id: runId, status: "PENDING" },
          data: { status: "CANCELLED", completedAt: new Date() },
        });
      }
    }
    if (entry.name === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE) {
      const runId = str(data, "runId");
      if (runId) await abortProjectFolderRun(deps.prisma, runId);
    }
    await job.remove();
    return { queue: entry.name, jobId: job.id!, workspaceId, mode: "removed" };
  }

  if (state === "failed" || state === "completed") {
    if (entry.name === QueueNames.MAILBOX_HISTORICAL_IMPORT) {
      const importId = str(data, "importId");
      if (importId) {
        const updated = await deps.prisma.mailboxHistoricalImport.updateMany({
          where: { id: importId, status: { in: ["PENDING", "RUNNING"] } },
          data: { status: "CANCELLED", completedAt: new Date(), errorMessage: ABORT_MESSAGE },
        });
        if (updated.count > 0) {
          return { queue: entry.name, jobId: job.id!, workspaceId, mode: "closed" };
        }
      }
    }
    if (entry.name === QueueNames.MAILBOX_RECLASSIFY) {
      const runId = str(data, "runId");
      if (runId) {
        const updated = await deps.prisma.mailboxReclassifyRun.updateMany({
          where: { id: runId, status: { in: ["PENDING", "RUNNING", "CANCELLING"] } },
          data: { status: "CANCELLED", completedAt: new Date(), errorMessage: ABORT_MESSAGE },
        });
        if (updated.count > 0) {
          return { queue: entry.name, jobId: job.id!, workspaceId, mode: "closed" };
        }
      }
    }
    if (entry.name === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE) {
      const runId = str(data, "runId");
      if (runId) {
        const count = await abortProjectFolderRun(deps.prisma, runId);
        if (count > 0) {
          return { queue: entry.name, jobId: job.id!, workspaceId, mode: "closed" };
        }
      }
    }
  }

  if (state !== "active") {
    throw new WorkerJobActionError("This job is not waiting or running", 409, "CANCEL_UNAVAILABLE");
  }

  if (entry.name === QueueNames.MAILBOX_HISTORICAL_IMPORT) {
    const importId = str(data, "importId");
    if (!importId) throw new WorkerJobActionError("Import id missing", 409, "CANCEL_UNAVAILABLE");
    const updated = await deps.prisma.mailboxHistoricalImport.updateMany({
      where: { id: importId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      throw new WorkerJobActionError("Import is not running", 409, "CANCEL_UNAVAILABLE");
    }
    return { queue: entry.name, jobId: job.id!, workspaceId, mode: "cooperative" };
  }

  if (entry.name === QueueNames.MAILBOX_RECLASSIFY) {
    const runId = str(data, "runId");
    if (!runId) throw new WorkerJobActionError("Run id missing", 409, "CANCEL_UNAVAILABLE");
    const run = await deps.prisma.mailboxReclassifyRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (!run || (run.status !== "PENDING" && run.status !== "RUNNING" && run.status !== "CANCELLING")) {
      throw new WorkerJobActionError("Run cannot be cancelled", 409, "CANCEL_UNAVAILABLE");
    }
    await deps.prisma.mailboxReclassifyRun.update({
      where: { id: runId },
      data: {
        status: run.status === "PENDING" ? "CANCELLED" : "CANCELLING",
        ...(run.status === "PENDING" ? { completedAt: new Date() } : {}),
      },
    });
    return { queue: entry.name, jobId: job.id!, workspaceId, mode: "cooperative" };
  }

  if (entry.name === QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE) {
    const runId = str(data, "runId");
    if (!runId) throw new WorkerJobActionError("Run id missing", 409, "CANCEL_UNAVAILABLE");
    const count = await abortProjectFolderRun(deps.prisma, runId);
    if (count === 0) {
      throw new WorkerJobActionError("This analysis is not running", 409, "CANCEL_UNAVAILABLE");
    }
    return { queue: entry.name, jobId: job.id!, workspaceId, mode: "cooperative" };
  }

  throw new WorkerJobActionError(
    "This job cannot be paused or cancelled once it has started. Wait for it to finish.",
    409,
    "CANCEL_UNAVAILABLE"
  );
}

export async function setQueuePaused(
  deps: { queues: WorkerQueueBundle[] },
  queueName: string,
  paused: boolean
): Promise<{ queue: QueueName; paused: boolean }> {
  const entry = bundle(deps.queues, queueName);
  if (paused) await entry.queue.pause();
  else await entry.queue.resume();
  return { queue: entry.name, paused };
}
