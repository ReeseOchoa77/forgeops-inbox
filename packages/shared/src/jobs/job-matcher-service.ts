import {
  JOB_MATCHER_VERSION,
  type JobAliasForMatch,
  type JobMatchCandidateScore,
  type JobMatchInput,
  type JobMatchResult,
  type JobRecordForMatch,
} from "./job-matcher.js";
import type { JobContactHit } from "./job-contact-marker.js";
import { jobMatchPipelineFromEmailInput } from "./job-match-pipeline.js";
import { DEFAULT_JOB_MATCH_IDENTITY_POLICY } from "./job-name-identity-policy.js";
import { runJobNameMarker } from "./job-name-marker.js";
import type { JobThreadHit } from "./job-thread-marker.js";

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
  loadActiveExactContactJobs: (input: {
    workspaceId: string;
    senderEmail: string | null | undefined;
    excludeEmailMessageId?: string | null;
    eligibleJobs: JobRecordForMatch[];
  }) => Promise<JobContactHit[]>;
  loadAuthoritativeThreadJobs: (input: {
    workspaceId: string;
    inboxConnectionId?: string | null | undefined;
    providerThreadId?: string | null | undefined;
    excludeEmailMessageId?: string | null | undefined;
    eligibleJobs: JobRecordForMatch[];
  }) => Promise<JobThreadHit[]>;
};

/**
 * Canonical ForgeOps job matcher.
 * Marker 1 unique MATCH stops. Otherwise Marker 2 then Marker 3 narrow.
 * Persistence remains gated by JOB_MATCHER_AUTO_ASSIGN_ENABLED.
 */
export class JobMatcherService {
  constructor(
    private readonly loader: JobMatchDataLoader,
    private readonly aiResolver?: JobMatchAiResolver | null,
    private readonly options?: { logCompletions?: boolean }
  ) {}

  async match(input: JobMatchInput): Promise<JobMatchResult> {
    const identityPolicy =
      input.identityPolicy ?? DEFAULT_JOB_MATCH_IDENTITY_POLICY;
    const resolvedInput: JobMatchInput = {
      ...input,
      identityPolicy,
    };

    const [jobs, aliases] = await Promise.all([
      this.loader.loadActiveJobs(input.workspaceId),
      this.loader.loadJobAliases(input.workspaceId),
    ]);

    const namePreview = runJobNameMarker({
      subject: resolvedInput.subject,
      bodyText: resolvedInput.bodyText,
      cleanBody: resolvedInput.cleanBody,
      jobs,
      aliases,
      eligibilityMode: resolvedInput.eligibilityMode ?? "production",
      identityPolicy,
    });

    let contactHits: JobContactHit[] | undefined;
    let threadHits: JobThreadHit[] | undefined;
    if (!(namePreview.status === "MATCH" && namePreview.selectedJobId)) {
      const [contacts, threads] = await Promise.all([
        this.loader.loadActiveExactContactJobs({
          workspaceId: resolvedInput.workspaceId,
          senderEmail: resolvedInput.senderEmail,
          excludeEmailMessageId: resolvedInput.emailMessageId ?? null,
          eligibleJobs: jobs,
        }),
        this.loader.loadAuthoritativeThreadJobs({
          workspaceId: resolvedInput.workspaceId,
          inboxConnectionId: resolvedInput.inboxConnectionId ?? null,
          providerThreadId: resolvedInput.providerThreadId ?? null,
          excludeEmailMessageId: resolvedInput.emailMessageId ?? null,
          eligibleJobs: jobs,
        }),
      ]);
      contactHits = contacts;
      threadHits = threads;
    }

    const result = jobMatchPipelineFromEmailInput(
      resolvedInput,
      jobs,
      aliases,
      {
        contactHits,
        threadHits,
      }
    );

    if (this.options?.logCompletions !== false) {
      console.info("job-match-completed", {
        workspaceId: resolvedInput.workspaceId,
        emailMessageId: resolvedInput.emailMessageId ?? null,
        identityPolicy,
        candidateCount: result.candidateCount,
        selectedJobId: result.selectedJobId,
        decision: result.decision ?? null,
        confidence: Number(result.confidence.toFixed(4)),
        evidenceTypes: result.evidence.map((e) => e.type),
        requiresReview: result.requiresReview,
        matcherVersion: result.matcherVersion || JOB_MATCHER_VERSION,
        aiResolverConfigured: Boolean(this.aiResolver),
      });
    }

    return result;
  }
}
