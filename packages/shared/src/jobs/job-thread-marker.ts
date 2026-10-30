import { isAuthoritativeEmailJobAssignment } from "../project-folders/verified-folder-job-assignment.js";
import type { JobMatchEvidence, JobRecordForMatch } from "./job-matcher.js";
import {
  isJobMatcherEligibleStatus,
  type JobMatchEligibilityMode,
} from "./job-name-marker.js";

export const JOB_THREAD_MARKER_VERSION = "job-thread-marker-v1";

export type JobThreadHit = {
  jobId: string;
  supportingEmailIds: string[];
};

export type JobThreadMarkerResult = {
  candidateJobIds: string[];
  evidence: JobMatchEvidence[];
  hits: JobThreadHit[];
  markerVersion: string;
};

const SUPPORTING_EMAIL_LIMIT = 5;

export type ThreadEmailRow = {
  id: string;
  jobId: string | null;
  inboxConnectionId: string;
  providerThreadId: string | null;
  jobAssignmentIsManual?: boolean | null;
  jobAssignmentSource?: string | null;
};

function eligibleJobIdSet(
  jobs: JobRecordForMatch[],
  mode: JobMatchEligibilityMode = "production"
): Set<string> {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (isJobMatcherEligibleStatus(job.status, mode)) ids.add(job.id);
  }
  return ids;
}

/**
 * Authoritative Jobs on the same mailbox-scoped provider thread.
 * providerThreadId is NOT globally unique — inboxConnectionId is required.
 * No majority vote: each distinct Job is one candidate.
 */
export function selectAuthoritativeThreadHits(input: {
  inboxConnectionId: string | null | undefined;
  providerThreadId: string | null | undefined;
  excludeEmailMessageId?: string | null | undefined;
  eligibleJobs: JobRecordForMatch[];
  messages: ThreadEmailRow[];
  eligibilityMode?: JobMatchEligibilityMode;
}): JobThreadHit[] {
  const connectionId = input.inboxConnectionId?.trim() || "";
  const threadId = input.providerThreadId?.trim() || "";
  if (!connectionId || !threadId) return [];
  const eligible = eligibleJobIdSet(
    input.eligibleJobs,
    input.eligibilityMode ?? "production"
  );
  const emailsByJob = new Map<string, string[]>();

  for (const row of input.messages) {
    if (!row.jobId || !eligible.has(row.jobId)) continue;
    if (input.excludeEmailMessageId && row.id === input.excludeEmailMessageId) {
      continue;
    }
    if (row.inboxConnectionId !== connectionId) continue;
    if ((row.providerThreadId ?? "").trim() !== threadId) continue;
    if (!isAuthoritativeEmailJobAssignment(row)) continue;
    const ids = emailsByJob.get(row.jobId) ?? [];
    if (ids.length < SUPPORTING_EMAIL_LIMIT) ids.push(row.id);
    emailsByJob.set(row.jobId, ids);
  }

  return [...emailsByJob.entries()].map(([jobId, supportingEmailIds]) => ({
    jobId,
    supportingEmailIds,
  }));
}

export function runJobThreadMarker(input: {
  inboxConnectionId?: string | null | undefined;
  providerThreadId?: string | null | undefined;
  hits?: JobThreadHit[] | undefined;
  eligibleJobs: JobRecordForMatch[];
  eligibilityMode?: JobMatchEligibilityMode;
}): JobThreadMarkerResult {
  const connectionId = input.inboxConnectionId?.trim() || "";
  const threadId = input.providerThreadId?.trim() || "";
  if (!connectionId || !threadId) {
    return {
      candidateJobIds: [],
      evidence: [],
      hits: [],
      markerVersion: JOB_THREAD_MARKER_VERSION,
    };
  }
  const eligible = eligibleJobIdSet(
    input.eligibleJobs,
    input.eligibilityMode ?? "production"
  );
  const hits = (input.hits ?? []).filter((hit) => eligible.has(hit.jobId));
  const candidateJobIds = [...new Set(hits.map((h) => h.jobId))];
  const evidence: JobMatchEvidence[] = [];
  if (candidateJobIds.length > 0) {
    evidence.push({
      type: "THREAD_JOB_AUTHORITATIVE",
      value: `${threadId} | conn=${connectionId} | jobs=${candidateJobIds.join(",")}`.slice(
        0,
        200
      ),
      confidence: candidateJobIds.length === 1 ? 0.9 : 0.72,
    });
    for (const hit of hits) {
      const support = hit.supportingEmailIds.slice(0, SUPPORTING_EMAIL_LIMIT).join(",");
      evidence.push({
        type: "THREAD_JOB_AUTHORITATIVE",
        value: `${hit.jobId} | emails=${support}`.slice(0, 200),
        confidence: 0.9,
      });
    }
  }
  return {
    candidateJobIds,
    evidence,
    hits,
    markerVersion: JOB_THREAD_MARKER_VERSION,
  };
}
