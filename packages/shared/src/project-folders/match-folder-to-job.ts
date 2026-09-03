/**
 * Deterministic folder → Job matching for native /Projects discovery.
 *
 * Product mapping (DB FolderStatus ↔ UI match status):
 *   DISCOVERED → UNMATCHED
 *   MATCHED    → SUGGESTED
 *   APPROVED   → VERIFIED  (eligible for future folder-email analysis)
 *   IGNORED / ARCHIVED unchanged
 *
 * Auto-verify only on unique exact Job.jobNumber match.
 */

import { normalizeName } from "../reference/normalize.js";

export type FolderMatchStatusUi =
  | "UNMATCHED"
  | "SUGGESTED"
  | "VERIFIED"
  | "IGNORED"
  | "ARCHIVED";

export type FolderStatusDb =
  | "DISCOVERED"
  | "MATCHED"
  | "APPROVED"
  | "IGNORED"
  | "ARCHIVED";

export function folderStatusToMatchUi(status: FolderStatusDb): FolderMatchStatusUi {
  switch (status) {
    case "DISCOVERED":
      return "UNMATCHED";
    case "MATCHED":
      return "SUGGESTED";
    case "APPROVED":
      return "VERIFIED";
    case "IGNORED":
      return "IGNORED";
    case "ARCHIVED":
      return "ARCHIVED";
  }
}

export function detectJobInfo(folderName: string): {
  jobNumber: string | null;
  jobName: string | null;
} {
  const match = folderName.match(/^(\d{2,6})\s*[-–—]\s*(.+)$/);
  if (match) return { jobNumber: match[1]!, jobName: match[2]!.trim() };
  const numMatch = folderName.match(/^(\d{2,6})\s+(.+)$/);
  if (numMatch) return { jobNumber: numMatch[1]!, jobName: numMatch[2]!.trim() };
  return { jobNumber: null, jobName: null };
}

export type JobMatchCandidate = {
  id: string;
  jobNumber: string | null;
  name: string;
  normalizedName: string;
  customerName?: string | null;
};

export type JobAliasCandidate = {
  jobId: string;
  normalizedAlias: string;
  source: string;
};

export type FolderJobMatchResult = {
  matchedJobId: string | null;
  status: "DISCOVERED" | "MATCHED" | "APPROVED";
  confidence: number | null;
  reason: string | null;
  detectedJobNumber: string | null;
  detectedJobName: string | null;
};

/**
 * Match a project folder name against existing Jobs (source of truth).
 * Never invents a Job. Ambiguous candidates → UNMATCHED.
 */
export function matchFolderToExistingJobs(input: {
  folderName: string;
  jobs: readonly JobMatchCandidate[];
  aliases?: readonly JobAliasCandidate[];
}): FolderJobMatchResult {
  const info = detectJobInfo(input.folderName);
  const normalizedFolder = normalizeName(input.folderName);
  const normalizedDetectedName = info.jobName ? normalizeName(info.jobName) : null;

  // 1) Unique exact job number → VERIFIED (auto)
  if (info.jobNumber) {
    const byNumber = input.jobs.filter((j) => j.jobNumber === info.jobNumber);
    if (byNumber.length === 1) {
      return {
        matchedJobId: byNumber[0]!.id,
        status: "APPROVED",
        confidence: 1,
        reason: "exact_job_number",
        detectedJobNumber: info.jobNumber,
        detectedJobName: info.jobName,
      };
    }
    if (byNumber.length > 1) {
      return {
        matchedJobId: null,
        status: "DISCOVERED",
        confidence: null,
        reason: "ambiguous_job_number",
        detectedJobNumber: info.jobNumber,
        detectedJobName: info.jobName,
      };
    }
  }

  // 2) Unique exact normalized job name (from detected name or full folder name) → SUGGESTED
  const nameKeys = [normalizedDetectedName, normalizedFolder].filter(
    (v): v is string => Boolean(v)
  );
  for (const key of nameKeys) {
    const byName = input.jobs.filter((j) => j.normalizedName === key);
    if (byName.length === 1) {
      return {
        matchedJobId: byName[0]!.id,
        status: "MATCHED",
        confidence: 0.92,
        reason: "exact_job_name",
        detectedJobNumber: info.jobNumber,
        detectedJobName: info.jobName ?? input.folderName,
      };
    }
    if (byName.length > 1) {
      return {
        matchedJobId: null,
        status: "DISCOVERED",
        confidence: null,
        reason: "ambiguous_job_name",
        detectedJobNumber: info.jobNumber,
        detectedJobName: info.jobName,
      };
    }
  }

  // 3) Unique non-OUTLOOK_FOLDER alias → SUGGESTED
  const aliases = (input.aliases ?? []).filter((a) => a.source !== "OUTLOOK_FOLDER");
  const aliasHits = aliases.filter((a) => a.normalizedAlias === normalizedFolder);
  const uniqueJobIds = [...new Set(aliasHits.map((a) => a.jobId))];
  if (uniqueJobIds.length === 1) {
    return {
      matchedJobId: uniqueJobIds[0]!,
      status: "MATCHED",
      confidence: 0.85,
      reason: "alias",
      detectedJobNumber: info.jobNumber,
      detectedJobName: info.jobName,
    };
  }
  if (uniqueJobIds.length > 1) {
    return {
      matchedJobId: null,
      status: "DISCOVERED",
      confidence: null,
      reason: "ambiguous_alias",
      detectedJobNumber: info.jobNumber,
      detectedJobName: info.jobName,
    };
  }

  return {
    matchedJobId: null,
    status: "DISCOVERED",
    confidence: null,
    reason: null,
    detectedJobNumber: info.jobNumber,
    detectedJobName: info.jobName,
  };
}

/** Future email-analysis gate: only VERIFIED (APPROVED) folders. */
export function isVerifiedProjectFolder(status: FolderStatusDb): boolean {
  return status === "APPROVED";
}

export const PROJECTS_ROOT_DISPLAY_NAME = "Projects";
