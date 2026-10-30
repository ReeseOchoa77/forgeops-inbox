/**
 * Operator-only, read-only historical Job matcher evaluation.
 * Intended for a Railway API shell after deploy. Prints a report; never persists.
 *
 *   node apps/api/dist/scripts/evaluate-job-matcher-production.js --workspace <id>
 */
import {
  JobMatcherService,
  aggregateHistoricalEvalResults,
  buildWrongMatchDetails,
  createJobMatchEvalLoaderFromSnapshot,
  formatHistoricalEvalReport,
  isHistoricalEvalGroundTruth,
  isJobMatcherAutoAssignEnabled,
  parseHistoricalEvalCliArgs,
  type HistoricalEvalEmail,
} from "@forgeops/shared";
import {
  findEvalJobInWorkspace,
  findEvalWorkspace,
  loadHistoricalEvalDatasetSummary,
  loadHistoricalEvalEmailsPage,
  loadJobMatchEvalSnapshot,
} from "../application/services/job-match-eval-read.js";
import { createReadOnlyPrisma } from "../application/services/read-only-prisma.js";

const USAGE = `FORGEOPS JOB MATCHER HISTORICAL EVALUATION (read-only)

Requires --workspace. Railway provides DATABASE_URL; do not paste it into Cursor.

  node apps/api/dist/scripts/evaluate-job-matcher-production.js --workspace <workspaceId>
  node apps/api/dist/scripts/evaluate-job-matcher-production.js --workspace <workspaceId> --limit 500 --max-wrong-details 50

Optional:
  --job <jobId>
  --limit <n>
  --max-wrong-details <n>   (default 50)
  --concurrency <n>         (default 1, max 4)
`;

const EVAL_PAGE_SIZE = 100;

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Run this from the Railway API shell so the platform injects production DATABASE_URL. Do not put production DATABASE_URL in Cursor."
    );
  }

  const args = parseHistoricalEvalCliArgs(argv);
  const prisma = createReadOnlyPrisma();

  try {
    const workspace = await findEvalWorkspace(prisma, args.workspace);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspace}`);
    }
    if (args.jobId) {
      const job = await findEvalJobInWorkspace(prisma, args.workspace, args.jobId);
      if (!job) {
        throw new Error(
          `Job ${args.jobId} was not found in workspace ${args.workspace}`
        );
      }
    }

    const dataset = await loadHistoricalEvalDatasetSummary(prisma, workspace);
    console.log("FORGEOPS JOB MATCHER HISTORICAL EVALUATION");
    console.log("");
    console.log("Dataset (before evaluation)");
    console.log("---------------------------");
    console.log(`Workspace: ${dataset.workspaceId} (${dataset.workspaceName ?? ""})`);
    console.log(`Total emails: ${dataset.totalEmails}`);
    console.log(`Job-linked: ${dataset.jobLinkedEmails}`);
    console.log(`Authoritative: ${dataset.authoritativeEmails}`);
    console.log(`Non-authoritative job-linked: ${dataset.nonAuthoritativeJobLinkedEmails}`);
    console.log(`Jobs represented: ${dataset.distinctAuthoritativeJobs}`);
    console.log(`Inbox connections: ${dataset.distinctInboxConnections}`);
    console.log("");
    console.log("Loading workspace snapshot (read-only)...");

    const snapshot = await loadJobMatchEvalSnapshot(prisma, args.workspace);
    const matcher = new JobMatcherService(
      createJobMatchEvalLoaderFromSnapshot(snapshot),
      null,
      { logCompletions: false }
    );
    const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job]));

    const evaluated: HistoricalEvalEmail[] = [];
    let cursor: string | undefined;
    const limit = args.limit;

    while (limit === null || evaluated.length < limit) {
      const remaining = limit === null ? EVAL_PAGE_SIZE : limit - evaluated.length;
      const page = await loadHistoricalEvalEmailsPage(prisma, {
        workspaceId: args.workspace,
        jobId: args.jobId,
        cursor,
        take: Math.min(EVAL_PAGE_SIZE, remaining),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1]!.id;

      const groundTruth = page.filter(isHistoricalEvalGroundTruth);
      const scored = await mapLimit(groundTruth, args.concurrency, async (email) => {
        const result = await matcher.match({
          workspaceId: args.workspace,
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
      console.log(`Evaluated ${evaluated.length} authoritative emails...`);
    }

    const metrics = aggregateHistoricalEvalResults(evaluated);
    const wrong = buildWrongMatchDetails({
      rows: evaluated,
      jobsById,
      maxWrongDetails: args.maxWrongDetails,
    });
    console.log("");
    console.log(
      formatHistoricalEvalReport({
        dataset,
        metrics,
        wrong,
        autoAssignEnabled: isJobMatcherAutoAssignEnabled(),
        databaseWrites: "NONE",
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
