/**
 * Compact evidence helpers for BidCandidateEmail.matchEvidence.
 * Manual user associations must survive analysis reruns.
 */

export function bidCandidateEmailEvidenceLabels(
  raw: unknown
): string[] {
  if (!raw || typeof raw !== "object") return [];
  const labels = (raw as { labels?: unknown }).labels;
  if (!Array.isArray(labels)) return [];
  return labels.filter((l): l is string => typeof l === "string");
}

export function isUserConfirmedBidCandidateEmail(
  matchEvidence: unknown
): boolean {
  const labels = bidCandidateEmailEvidenceLabels(matchEvidence);
  return (
    labels.includes("user_confirmed") ||
    labels.includes("manual_assign") ||
    labels.includes("manual_create")
  );
}

export function userConfirmedBidCandidateEmailEvidence(source: string): {
  labels: string[];
  source: string;
  userConfirmed: true;
} {
  return {
    labels: ["user_confirmed", "manual_assign", source],
    source,
    userConfirmed: true,
  };
}
