/** Shared eligibility / blocked-reason helpers for Bid Candidate import. */

export function computeImportBlockedReason(c: {
  status: string;
  proposedProjectName: string | null;
  existingJobMatchStatus: string;
}): string | null {
  if (c.status === "CONFIRMED") return "Already imported";
  if (c.status === "REJECTED") return "Rejected";
  if (!c.proposedProjectName?.trim()) return "Missing project name";
  if (
    c.existingJobMatchStatus === "POSSIBLE" ||
    c.existingJobMatchStatus === "STRONG" ||
    c.existingJobMatchStatus === "NEEDS_REVIEW"
  ) {
    return "Unresolved existing Job match";
  }
  if (c.status === "NEEDS_REVIEW") return "Needs review";
  return null;
}
