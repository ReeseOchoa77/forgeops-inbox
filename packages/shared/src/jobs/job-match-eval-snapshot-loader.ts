import type { JobAliasForMatch, JobRecordForMatch } from "./job-matcher.js";
import type { JobMatchDataLoader } from "./job-matcher-service.js";
import {
  selectActiveContactHits,
  type AuthoritativeSenderEmailRow,
  type ManualContactRow,
} from "./job-contact-marker.js";
import {
  selectAuthoritativeThreadHits,
  type ThreadEmailRow,
} from "./job-thread-marker.js";

export type JobMatchEvalEvidenceEmail = AuthoritativeSenderEmailRow &
  ThreadEmailRow & {
    senderEmail: string;
    inboxConnectionId: string;
    providerThreadId: string | null;
  };

export type JobMatchEvalSnapshot = {
  workspaceId: string;
  jobs: JobRecordForMatch[];
  aliases: JobAliasForMatch[];
  manualContacts: ManualContactRow[];
  authoritativeEmails: JobMatchEvalEvidenceEmail[];
};

/**
 * In-memory JobMatchDataLoader for historical evaluation.
 * Workspace-scoped snapshot. Holdout is excludeEmailMessageId, not a DB write.
 */
export function createJobMatchEvalLoaderFromSnapshot(
  snapshot: JobMatchEvalSnapshot
): JobMatchDataLoader {
  return {
    async loadActiveJobs(workspaceId) {
      if (workspaceId !== snapshot.workspaceId) return [];
      return snapshot.jobs;
    },
    async loadJobAliases(workspaceId) {
      if (workspaceId !== snapshot.workspaceId) return [];
      return snapshot.aliases;
    },
    async loadSenderCustomerJobIds() {
      return new Set();
    },
    async loadThreadJobHint() {
      return null;
    },
    async loadActiveExactContactJobs(input) {
      if (input.workspaceId !== snapshot.workspaceId) return [];
      return selectActiveContactHits({
        senderEmail: input.senderEmail,
        excludeEmailMessageId: input.excludeEmailMessageId ?? null,
        eligibleJobs: input.eligibleJobs,
        eligibilityMode: "evaluation",
        manualContacts: snapshot.manualContacts,
        authoritativeEmails: snapshot.authoritativeEmails,
      });
    },
    async loadAuthoritativeThreadJobs(input) {
      if (input.workspaceId !== snapshot.workspaceId) return [];
      return selectAuthoritativeThreadHits({
        inboxConnectionId: input.inboxConnectionId,
        providerThreadId: input.providerThreadId,
        excludeEmailMessageId: input.excludeEmailMessageId ?? null,
        eligibleJobs: input.eligibleJobs,
        eligibilityMode: "evaluation",
        messages: snapshot.authoritativeEmails,
      });
    },
  };
}
