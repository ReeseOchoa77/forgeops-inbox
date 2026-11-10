/**
 * Workspace-scoped, read-only Job Matcher historical evaluation for Intelligence UI.
 * Reuses the same snapshot/eval helpers as the Railway CLI. Never persists matches.
 */
import {
  JobMatcherService,
  aggregateHistoricalEvalResults,
  buildWrongMatchDetails,
  createJobMatchEvalLoaderFromSnapshot,
  isHistoricalEvalGroundTruth,
  isJobMatcherAutoAssignEnabled,
  type HistoricalEvalEmail,
  type HistoricalEvalMetrics,
  type HistoricalEvalWrongDetail,
} from "@forgeops/shared";
import type { PrismaClient } from "@prisma/client";
import {
  findEvalWorkspace,
  loadHistoricalEvalDatasetSummary,
  loadHistoricalEvalEmailsPage,
  loadJobMatchEvalSnapshot,
} from "./job-match-eval-read.js";

const EVAL_PAGE_SIZE = 100;
const ALLOWED_LIMITS = new Set([50, 100, 500]);

export type JobMatcherHistoricalEvalResult = {
  intelligenceId: "job-matcher";
  databaseWrites: "NONE";
  autoAssignEnabled: boolean;
  sampleSizeRequested: number;
  dataset: Awaited<ReturnType<typeof loadHistoricalEvalDatasetSummary>>;
  metrics: HistoricalEvalMetrics;
  wrongMatches: HistoricalEvalWrongDetail[];
  groundTruthQuality: "MODERATE";
  groundTruthNotes: string;
};

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        out[index] = await fn(items[index]!);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

export async function runJobMatcherHistoricalEval(input: {
  prisma: PrismaClient;
  workspaceId: string;
  limit: number;
  maxWrongDetails?: number;
}): Promise<JobMatcherHistoricalEvalResult> {
  if (!ALLOWED_LIMITS.has(input.limit)) {
    throw new Error("limit must be 50, 100, or 500");
  }

  const workspace = await findEvalWorkspace(input.prisma, input.workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found");
  }

  const dataset = await loadHistoricalEvalDatasetSummary(input.prisma, workspace);
  const snapshot = await loadJobMatchEvalSnapshot(input.prisma, input.workspaceId);
  const matcher = new JobMatcherService(
    createJobMatchEvalLoaderFromSnapshot(snapshot),
    null,
    { logCompletions: false }
  );
  const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job]));

  const evaluated: HistoricalEvalEmail[] = [];
  let cursor: string | undefined;
  const limit = input.limit;

  while (evaluated.length < limit) {
    const remaining = limit - evaluated.length;
    const page = await loadHistoricalEvalEmailsPage(input.prisma, {
      workspaceId: input.workspaceId,
      cursor,
      take: Math.min(EVAL_PAGE_SIZE, remaining * 3),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;

    const groundTruth = page.filter(isHistoricalEvalGroundTruth);
    if (groundTruth.length === 0) continue;

    const batch = groundTruth.slice(0, remaining);
    const scored = await mapLimit(batch, 2, async (email) => {
      const result = await matcher.match({
        workspaceId: input.workspaceId,
        emailMessageId: email.id,
        inboxConnectionId: email.inboxConnectionId,
        subject: email.subject,
        cleanBody: email.cleanBody,
        senderEmail: email.senderEmail,
        providerThreadId: email.providerThreadId,
        eligibilityMode: "evaluation",
      });
      return {
        id: email.id,
        subject: email.subject,
        direction: email.direction,
        trueJobId: email.jobId,
        hasAttachments: email.hasAttachments,
        result,
      };
    });
    evaluated.push(...scored);
  }

  const metrics = aggregateHistoricalEvalResults(evaluated);
  const wrong = buildWrongMatchDetails({
    rows: evaluated,
    jobsById,
    maxWrongDetails: input.maxWrongDetails ?? 50,
  });

  return {
    intelligenceId: "job-matcher",
    databaseWrites: "NONE",
    autoAssignEnabled: isJobMatcherAutoAssignEnabled(),
    sampleSizeRequested: input.limit,
    dataset,
    metrics,
    wrongMatches: wrong.details,
    groundTruthQuality: "MODERATE",
    groundTruthNotes:
      "Authoritative EmailMessage.jobId (USER_ASSIGNED / VERIFIED_PROJECT_FOLDER). Folder labels can be noisy. AI_* / JOB_NUMBER_MATCH / IMPORT excluded.",
  };
}
