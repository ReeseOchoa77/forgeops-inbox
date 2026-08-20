import {
  JOB_MATCHER_VERSION,
  rankJobMatchCandidates,
  selectJobMatchFromCandidates,
  type JobAliasForMatch,
  type JobMatchCandidateScore,
  type JobMatchInput,
  type JobMatchResult,
  type JobRecordForMatch,
} from "./job-matcher.js";

export type JobMatchAiResolver = (input: {
  subject: string;
  bodyExcerpt: string;
  senderEmail?: string | null;
  senderDomain?: string | null;
  candidates: JobMatchCandidateScore[];
}) => Promise<{
  selectedJobId: string | null;
  confidence?: number;
} | null>;

export type JobMatchDataLoader = {
  loadActiveJobs: (workspaceId: string) => Promise<JobRecordForMatch[]>;
  loadJobAliases: (workspaceId: string) => Promise<JobAliasForMatch[]>;
  loadSenderCustomerJobIds: (
    workspaceId: string,
    senderEmail: string | null | undefined
  ) => Promise<Set<string>>;
  loadThreadJobHint: (
    workspaceId: string,
    threadId: string | null | undefined
  ) => Promise<string | null>;
};

/**
 * Canonical ForgeOps job matcher. Deterministic first; optional AI resolver for ambiguity.
 * Same service contract for n8n and native ingestion.
 */
export class JobMatcherService {
  constructor(
    private readonly loader: JobMatchDataLoader,
    private readonly aiResolver?: JobMatchAiResolver | null
  ) {}

  async match(input: JobMatchInput): Promise<JobMatchResult> {
    const [jobs, aliases, senderCustomerJobIds, threadJobId] =
      await Promise.all([
        this.loader.loadActiveJobs(input.workspaceId),
        this.loader.loadJobAliases(input.workspaceId),
        this.loader.loadSenderCustomerJobIds(
          input.workspaceId,
          input.senderEmail
        ),
        this.loader.loadThreadJobHint(input.workspaceId, input.threadId),
      ]);

    const ranked = rankJobMatchCandidates({
      subject: input.subject,
      bodyText: input.bodyText ?? null,
      cleanBody: input.cleanBody ?? null,
      senderDomain: input.senderDomain ?? null,
      jobs,
      aliases,
      threadJobId,
      senderCustomerJobIds,
      limit: 10,
    });

    let result = selectJobMatchFromCandidates(ranked, {
      n8nHintJobId: input.n8nSelectedJobIdHint ?? null,
    });

    // AI only resolves ambiguous / reviewable top candidates — never searches all jobs.
    if (
      this.aiResolver &&
      result.requiresReview &&
      result.ambiguousCandidateIds.length > 0
    ) {
      try {
        const body = (input.cleanBody ?? input.bodyText ?? "").slice(0, 1500);
        const allowedIds = new Set(result.ambiguousCandidateIds);
        const candidatesForAi = ranked
          .filter((c) => allowedIds.has(c.jobId))
          .slice(0, 10);

        const resolved = await this.aiResolver({
          subject: input.subject ?? "",
          bodyExcerpt: body,
          senderEmail: input.senderEmail ?? null,
          senderDomain: input.senderDomain ?? null,
          candidates: candidatesForAi,
        });

        if (resolved?.selectedJobId) {
          if (allowedIds.has(resolved.selectedJobId)) {
            const base =
              candidatesForAi.find((c) => c.jobId === resolved.selectedJobId) ??
              ranked.find((c) => c.jobId === resolved.selectedJobId);
            const confidence = Math.min(
              1,
              Math.max(
                resolved.confidence ?? result.confidence,
                base?.score ?? result.confidence
              )
            );
            result = selectJobMatchFromCandidates(
              [
                {
                  jobId: resolved.selectedJobId,
                  score: confidence,
                  subjectScore: base?.subjectScore ?? 0,
                  contentScore: base?.contentScore ?? 0,
                  senderScore: base?.senderScore ?? 0,
                  evidence: base?.evidence ?? result.evidence,
                },
              ],
              {}
            );
          }
        } else if (resolved && resolved.selectedJobId === null) {
          result = {
            ...result,
            selectedJobId: null,
            assignmentSource: null,
            requiresReview: true,
          };
        }
      } catch {
        // Deterministic result stands when AI fails.
      }
    }

    console.info("job-match-completed", {
      workspaceId: input.workspaceId,
      emailMessageId: input.emailMessageId ?? null,
      candidateCount: result.candidateCount,
      selectedJobId: result.selectedJobId,
      confidence: Number(result.confidence.toFixed(4)),
      evidenceTypes: result.evidence.map((e) => e.type),
      requiresReview: result.requiresReview,
      matcherVersion: result.matcherVersion || JOB_MATCHER_VERSION,
    });

    return result;
  }
}
