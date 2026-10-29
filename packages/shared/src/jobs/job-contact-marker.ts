import { isAuthoritativeEmailJobAssignment } from "../project-folders/verified-folder-job-assignment.js";
import { normalizeEmail } from "../reference/normalize.js";
import type { JobMatchEvidence, JobRecordForMatch } from "./job-matcher.js";
import { isJobMatcherEligibleStatus } from "./job-name-marker.js";

export const JOB_CONTACT_MARKER_VERSION = "job-contact-marker-v1";

export type JobContactBasis = "MANUAL_JOB_CONTACT" | "CURRENT_AUTHORITATIVE_EMAIL";

export type JobContactHit = {
  jobId: string;
  basis: JobContactBasis;
  supportingEmailIds?: string[];
};

export type JobContactMarkerResult = {
  candidateJobIds: string[];
  evidence: JobMatchEvidence[];
  hits: JobContactHit[];
  markerVersion: string;
};

const SUPPORTING_EMAIL_LIMIT = 5;

export type ManualContactRow = {
  jobId: string;
  source: string;
  normalizedEmail?: string | null;
  email?: string | null;
};

export type AuthoritativeSenderEmailRow = {
  id: string;
  jobId: string | null;
  senderEmail: string;
  jobAssignmentIsManual?: boolean | null;
  jobAssignmentSource?: string | null;
};

function emailsMatch(
  sender: string,
  email: string | null | undefined,
  normalized: string | null | undefined
): boolean {
  if (normalized && normalized === sender) return true;
  if (email && normalizeEmail(email) === sender) return true;
  return false;
}

function eligibleJobIdSet(jobs: JobRecordForMatch[]): Set<string> {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (isJobMatcherEligibleStatus(job.status)) ids.add(job.id);
  }
  return ids;
}

/**
 * Active exact-contact Jobs for a sender.
 * LEARNED_FROM_EMAIL history alone does not count.
 * Held-out email ids are excluded from CURRENT_AUTHORITATIVE_EMAIL proof.
 */
export function selectActiveContactHits(input: {
  senderEmail: string | null | undefined;
  excludeEmailMessageId?: string | null | undefined;
  eligibleJobs: JobRecordForMatch[];
  manualContacts: ManualContactRow[];
  authoritativeEmails: AuthoritativeSenderEmailRow[];
}): JobContactHit[] {
  const sender = input.senderEmail?.trim()
    ? normalizeEmail(input.senderEmail)
    : "";
  if (!sender) return [];
  const eligible = eligibleJobIdSet(input.eligibleJobs);
  const byJob = new Map<string, JobContactHit>();

  for (const row of input.manualContacts) {
    if (row.source !== "MANUAL") continue;
    if (!eligible.has(row.jobId)) continue;
    if (!emailsMatch(sender, row.email, row.normalizedEmail)) continue;
    const existing = byJob.get(row.jobId);
    if (!existing) {
      byJob.set(row.jobId, { jobId: row.jobId, basis: "MANUAL_JOB_CONTACT" });
    }
  }

  const emailsByJob = new Map<string, string[]>();
  for (const row of input.authoritativeEmails) {
    if (!row.jobId || !eligible.has(row.jobId)) continue;
    if (input.excludeEmailMessageId && row.id === input.excludeEmailMessageId) {
      continue;
    }
    if (normalizeEmail(row.senderEmail) !== sender) continue;
    if (!isAuthoritativeEmailJobAssignment(row)) continue;
    const ids = emailsByJob.get(row.jobId) ?? [];
    if (ids.length < SUPPORTING_EMAIL_LIMIT) ids.push(row.id);
    emailsByJob.set(row.jobId, ids);
  }

  for (const [jobId, supportingEmailIds] of emailsByJob) {
    const existing = byJob.get(jobId);
    if (existing) {
      existing.supportingEmailIds = supportingEmailIds;
      continue;
    }
    byJob.set(jobId, {
      jobId,
      basis: "CURRENT_AUTHORITATIVE_EMAIL",
      supportingEmailIds,
    });
  }

  return [...byJob.values()];
}

export function runJobContactMarker(input: {
  senderEmail: string | null | undefined;
  hits?: JobContactHit[];
  eligibleJobs: JobRecordForMatch[];
}): JobContactMarkerResult {
  const sender = input.senderEmail?.trim()
    ? normalizeEmail(input.senderEmail)
    : "";
  const eligible = eligibleJobIdSet(input.eligibleJobs);
  const hits = (input.hits ?? []).filter((hit) => eligible.has(hit.jobId));
  const candidateJobIds = [...new Set(hits.map((h) => h.jobId))];
  const evidence: JobMatchEvidence[] = [];
  if (sender && candidateJobIds.length > 0) {
    evidence.push({
      type: "SENDER_JOB_CONTACT",
      value: `${sender} | jobs=${candidateJobIds.join(",")}`,
      confidence: candidateJobIds.length === 1 ? 0.86 : 0.7,
    });
    for (const hit of hits) {
      const support =
        hit.supportingEmailIds && hit.supportingEmailIds.length > 0
          ? ` | emails=${hit.supportingEmailIds.slice(0, SUPPORTING_EMAIL_LIMIT).join(",")}`
          : "";
      evidence.push({
        type: "SENDER_JOB_CONTACT",
        value: `${sender} | ${hit.jobId} | ${hit.basis}${support}`.slice(0, 200),
        confidence: hit.basis === "MANUAL_JOB_CONTACT" ? 0.88 : 0.84,
      });
    }
  }
  return {
    candidateJobIds,
    evidence,
    hits,
    markerVersion: JOB_CONTACT_MARKER_VERSION,
  };
}
