import { normalizeName } from "../reference/normalize.js";
import { extractProjectIdentityFromPdfFilenames } from "./extract-project-name-from-attachments.js";
import { suggestBidProjectNameFromSubject } from "./suggest-bid-project-name.js";

export type BidProjectNameSource =
  | "attachment"
  | "subject_cleanup"
  | "body"
  | "ai"
  | null;

export type BidProjectIdentity = {
  projectName: string | null;
  projectNameSource: BidProjectNameSource;
  /** Credible alternate names for EntityAlias after confirm (not persisted yet). */
  alternateProjectNames: string[];
};

const BODY_PROJECT_LABEL =
  /(?:^|\n)\s*(?:project(?:\s*name)?|job(?:\s*name)?|regarding|re)\s*[:\-–—]\s*(.+)$/im;

/** Subject leftovers that are invitation boilerplate, not a project title. */
const USELESS_PROJECT_TITLE =
  /^(?:invitation(?:\s+to\s+bid)?|invite(?:\s+to\s+bid)?|itb|bid\s+invitation|reminder|request\s+for\s+(?:bid|proposal|quote)|rf[bpq])\.?$/i;

export function isUselessProjectTitle(name: string | null | undefined): boolean {
  const t = name?.trim() ?? "";
  if (!t) return true;
  return USELESS_PROJECT_TITLE.test(t);
}

/**
 * Explicit labeled project identity from email body. Conservative.
 */
export function extractProjectNameFromBody(
  bodyText: string | null | undefined
): string | null {
  const raw = (bodyText ?? "").trim();
  if (!raw) return null;
  const match = raw.match(BODY_PROJECT_LABEL);
  const value = match?.[1]?.trim().split(/\n/)[0]?.trim() ?? "";
  if (!value || value.length < 3 || value.length > 300) return null;
  // Reject invitation boilerplate leftovers
  if (isUselessProjectTitle(value)) return null;
  if (!/[a-zA-Z]/.test(value)) return null;
  const normalized = normalizeName(value);
  if (!normalized || normalized.length < 3) return null;
  return value.slice(0, 300);
}

/**
 * Drop aliases that normalize equal to the canonical name or to each other.
 */
export function dedupeProjectAliases(
  canonicalName: string | null | undefined,
  aliases: Array<string | null | undefined>
): string[] {
  const canonicalNorm = normalizeName(canonicalName?.trim() ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of aliases) {
    const t = alias?.trim() ?? "";
    if (!t || t.length > 300) continue;
    const n = normalizeName(t);
    if (!n || n.length < 3) continue;
    if (canonicalNorm && n === canonicalNorm) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(t.slice(0, 300));
  }
  return out.slice(0, 10);
}

/**
 * Multi-source project identity for bidding intake.
 * Priority: credible PDF filename → subject → body → AI (when subject/body weak).
 */
export function resolveBidProjectIdentity(input: {
  pdfFilenames?: Array<string | null | undefined>;
  subject?: string | null;
  bodyText?: string | null;
  /** Optional AI refinement / alternates after deterministic resolve. */
  aiProjectName?: string | null;
  aiAlternateProjectNames?: Array<string | null | undefined>;
}): BidProjectIdentity {
  const attachment = extractProjectIdentityFromPdfFilenames(
    input.pdfFilenames ?? []
  );
  const subjectName = suggestBidProjectNameFromSubject(input.subject);
  const bodyName = extractProjectNameFromBody(input.bodyText);

  let projectName: string | null = null;
  let projectNameSource: BidProjectNameSource = null;

  if (attachment.projectName) {
    projectName = attachment.projectName;
    projectNameSource = "attachment";
  } else if (subjectName && !isUselessProjectTitle(subjectName)) {
    projectName = subjectName;
    projectNameSource = "subject_cleanup";
  } else if (bodyName) {
    projectName = bodyName;
    projectNameSource = "body";
  }

  // AI may refine when deterministic is empty/noisy, or supply a clearer form.
  const aiName = input.aiProjectName?.trim() || null;
  if (aiName) {
    if (!projectName) {
      projectName = aiName.slice(0, 300);
      projectNameSource = "ai";
    } else if (
      projectNameSource === "subject_cleanup" &&
      /^(invitation|itb|bid invitation|reminder)/i.test(projectName)
    ) {
      projectName = aiName.slice(0, 300);
      projectNameSource = "ai";
    } else if (
      projectNameSource === "attachment" &&
      normalizeName(aiName) === normalizeName(projectName)
    ) {
      // Prefer AI's accent/casing when same identity (e.g. Forté vs Forte)
      if (aiName !== projectName && /[éèêëáàâäóòôöúùûüíìîï]/i.test(aiName)) {
        projectName = aiName.slice(0, 300);
      }
    }
  }

  const alternateRaw: Array<string | null | undefined> = [
    ...attachment.candidates,
    subjectName,
    bodyName,
    ...(input.aiAlternateProjectNames ?? []),
    // When attachment won, subject is an important alternate even if similar length
    projectNameSource === "attachment" ? subjectName : null,
    projectNameSource === "attachment" ? bodyName : null,
  ];

  // When attachments conflicted, keep their candidates as alternates only
  if (attachment.conflicting) {
    alternateRaw.push(...attachment.candidates);
  }

  return {
    projectName,
    projectNameSource,
    alternateProjectNames: dedupeProjectAliases(projectName, alternateRaw),
  };
}
