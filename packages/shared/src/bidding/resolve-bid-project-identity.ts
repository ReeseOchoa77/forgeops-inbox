import { normalizeName } from "../reference/normalize.js";
import {
  extractProjectIdentityFromPdfFilenames,
  looksLikeDocumentWrapperTitle,
  stripDocumentPurposePhrases,
} from "./extract-project-name-from-attachments.js";
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

const DOCUMENT_WRAPPER_IN_NAME =
  /\b(?:bid\s+invit(?:e|ation)|invitation\s+to\s+bid|itb|request\s+for\s+(?:bid|quote|proposal)|bid\s+documents?|bid\s+package|bid\s+set|plan\s+set|construction\s+documents?|architectural\s+drawings?|structural\s+drawings?|specifications?|project\s+manual|addend(?:um|a)|proposal|quote|estimate)\b/i;

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
  if (isUselessProjectTitle(value)) return null;
  if (!/[a-zA-Z]/.test(value)) return null;
  const normalized = normalizeName(value);
  if (!normalized || normalized.length < 3) return null;
  return value.slice(0, 300);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove a known customer/contractor company prefix from a project candidate.
 */
export function stripCustomerFromProjectName(
  projectName: string | null | undefined,
  customerCompanyName?: string | null
): string | null {
  const project = projectName?.trim() ?? "";
  if (!project) return null;
  const customer = customerCompanyName?.trim() ?? "";
  if (!customer) return project;

  const pNorm = normalizeName(project);
  const cNorm = normalizeName(customer);
  if (!pNorm || !cNorm) return project;
  if (pNorm === cNorm) return project;

  // Full company at start: "CoBeck Construction - Prieto Battery"
  if (pNorm.startsWith(cNorm + " ") || pNorm.startsWith(cNorm)) {
    const stripped = project
      .replace(new RegExp(`^${escapeRegExp(customer)}\\s*[-–—,:]?\\s*`, "i"), "")
      .trim();
    if (stripped && stripped.length >= 3 && normalizeName(stripped) !== cNorm) {
      return stripped.slice(0, 300);
    }
  }

  // First token(s) of company at start when company is multi-word
  // e.g. customer "CoBeck Construction", project "CoBeck Bid Invite - Prieto Battery"
  const customerFirst = customer.split(/\s+/)[0] ?? "";
  if (
    customerFirst.length >= 3 &&
    new RegExp(`^${escapeRegExp(customerFirst)}\\b`, "i").test(project)
  ) {
    const withoutCompanyToken = stripDocumentPurposePhrases(
      project.replace(
        new RegExp(`^${escapeRegExp(customerFirst)}\\s*`, "i"),
        ""
      )
    );
    // Prefer dash-separated right side if present
    const dashParts = project.split(/\s*[-–—|]\s*/).map((s) => s.trim());
    if (dashParts.length >= 2) {
      const right = dashParts[dashParts.length - 1]!;
      if (
        right &&
        !DOCUMENT_WRAPPER_IN_NAME.test(right) &&
        normalizeName(right) !== cNorm &&
        right.length >= 3
      ) {
        return right.slice(0, 300);
      }
    }
    if (
      withoutCompanyToken &&
      withoutCompanyToken.length >= 3 &&
      !DOCUMENT_WRAPPER_IN_NAME.test(withoutCompanyToken)
    ) {
      return withoutCompanyToken.slice(0, 300);
    }
  }

  return project;
}

/**
 * True when `refined` is a cleaner project core of `noisy` (shorter, contained,
 * or equal after wrapper/company strip) — used to let AI override bad filenames.
 */
export function isCleanerProjectRefinement(
  refined: string,
  noisy: string
): boolean {
  const r = refined.trim();
  const n = noisy.trim();
  if (!r || !n) return false;
  const rNorm = normalizeName(r);
  const nNorm = normalizeName(n);
  if (!rNorm || !nNorm) return false;
  if (rNorm === nNorm) return false;
  if (DOCUMENT_WRAPPER_IN_NAME.test(r)) return false;
  if (looksLikeDocumentWrapperTitle(r)) return false;
  // Refined is contained in noisy (e.g. "Prieto Battery" in "CoBeck Bid Invite - Prieto Battery")
  if (nNorm.includes(rNorm) && rNorm.length >= 6) return true;
  // Noisy still has wrappers and refined does not
  if (DOCUMENT_WRAPPER_IN_NAME.test(n) && !DOCUMENT_WRAPPER_IN_NAME.test(r)) {
    const overlap = rNorm
      .split(/\s+/)
      .filter((t) => t.length > 1 && nNorm.includes(t));
    if (overlap.length >= Math.min(2, rNorm.split(/\s+/).length)) return true;
  }
  return false;
}

function isNoisyAlias(
  alias: string,
  customerCompanyName?: string | null
): boolean {
  const t = alias.trim();
  if (!t) return true;
  if (isUselessProjectTitle(t)) return true;
  if (looksLikeDocumentWrapperTitle(t)) return true;
  if (DOCUMENT_WRAPPER_IN_NAME.test(t)) return true;
  const cNorm = normalizeName(customerCompanyName?.trim() ?? "");
  const aNorm = normalizeName(t);
  if (cNorm && aNorm && (aNorm === cNorm || cNorm === aNorm)) return true;
  return false;
}

/**
 * Drop aliases that normalize equal to the canonical name or to each other.
 * Also drops document-wrapper / company composites — those are not Job aliases.
 */
export function dedupeProjectAliases(
  canonicalName: string | null | undefined,
  aliases: Array<string | null | undefined>,
  customerCompanyName?: string | null
): string[] {
  const canonicalNorm = normalizeName(canonicalName?.trim() ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of aliases) {
    const t = alias?.trim() ?? "";
    if (!t || t.length > 300) continue;
    if (isNoisyAlias(t, customerCompanyName)) continue;
    const cleaned = stripCustomerFromProjectName(t, customerCompanyName) ?? t;
    if (isNoisyAlias(cleaned, customerCompanyName)) continue;
    const n = normalizeName(cleaned);
    if (!n || n.length < 3) continue;
    if (canonicalNorm && n === canonicalNorm) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(cleaned.slice(0, 300));
  }
  return out.slice(0, 10);
}

/**
 * Multi-source project identity for bidding intake.
 * Priority: credible PDF filename → subject → body → AI.
 * AI may refine noisy attachment titles (company + document wrappers).
 * Filenames are evidence, not automatic Job names.
 */
export function resolveBidProjectIdentity(input: {
  pdfFilenames?: Array<string | null | undefined>;
  subject?: string | null;
  bodyText?: string | null;
  /** Optional AI refinement / alternates after deterministic resolve. */
  aiProjectName?: string | null;
  aiAlternateProjectNames?: Array<string | null | undefined>;
  /** Joint reasoning: strip contractor/customer from project when evidenced. */
  customerCompanyName?: string | null;
}): BidProjectIdentity {
  const customerCompanyName = input.customerCompanyName?.trim() || null;
  const attachment = extractProjectIdentityFromPdfFilenames(
    input.pdfFilenames ?? [],
    customerCompanyName
  );
  const subjectName = suggestBidProjectNameFromSubject(input.subject);
  const bodyName = extractProjectNameFromBody(input.bodyText);

  let projectName: string | null = null;
  let projectNameSource: BidProjectNameSource = null;

  if (attachment.projectName && !attachment.ambiguous) {
    projectName = stripCustomerFromProjectName(
      attachment.projectName,
      customerCompanyName
    );
    projectNameSource = "attachment";
  } else if (subjectName && !isUselessProjectTitle(subjectName)) {
    projectName = stripCustomerFromProjectName(subjectName, customerCompanyName);
    projectNameSource = "subject_cleanup";
  } else if (bodyName) {
    projectName = stripCustomerFromProjectName(bodyName, customerCompanyName);
    projectNameSource = "body";
  }

  const aiNameRaw = input.aiProjectName?.trim() || null;
  const aiName = aiNameRaw
    ? stripCustomerFromProjectName(aiNameRaw, customerCompanyName)
    : null;

  if (aiName && !looksLikeDocumentWrapperTitle(aiName) && !DOCUMENT_WRAPPER_IN_NAME.test(aiName)) {
    if (!projectName) {
      // Conflicting attachments: only accept AI when it agrees with subject/body
      if (attachment.conflicting) {
        const subjectOk =
          subjectName &&
          !isUselessProjectTitle(subjectName) &&
          (normalizeName(aiName) === normalizeName(subjectName) ||
            normalizeName(subjectName).includes(normalizeName(aiName)) ||
            normalizeName(aiName).includes(normalizeName(subjectName)));
        const bodyOk =
          bodyName &&
          (normalizeName(aiName) === normalizeName(bodyName) ||
            normalizeName(bodyName).includes(normalizeName(aiName)));
        if (subjectOk || bodyOk) {
          projectName = aiName.slice(0, 300);
          projectNameSource = "ai";
        }
      } else {
        projectName = aiName.slice(0, 300);
        projectNameSource = "ai";
      }
    } else if (
      projectNameSource === "subject_cleanup" &&
      /^(invitation|itb|bid invitation|reminder)/i.test(projectName)
    ) {
      projectName = aiName.slice(0, 300);
      projectNameSource = "ai";
    } else if (
      projectNameSource === "attachment" &&
      isCleanerProjectRefinement(aiName, projectName)
    ) {
      // AI peeled company/wrapper off a mechanical filename
      projectName = aiName.slice(0, 300);
      projectNameSource = "ai";
    } else if (
      projectNameSource === "attachment" &&
      normalizeName(aiName) === normalizeName(projectName)
    ) {
      if (aiName !== projectName && /[éèêëáàâäóòôöúùûüíìîï]/i.test(aiName)) {
        projectName = aiName.slice(0, 300);
      }
    } else if (
      (projectNameSource === "attachment" ||
        projectNameSource === "subject_cleanup") &&
      DOCUMENT_WRAPPER_IN_NAME.test(projectName) &&
      !DOCUMENT_WRAPPER_IN_NAME.test(aiName)
    ) {
      projectName = aiName.slice(0, 300);
      projectNameSource = "ai";
    }
  }

  // Final company strip after AI merge
  if (projectName) {
    projectName = stripCustomerFromProjectName(
      projectName,
      customerCompanyName
    );
  }

  const alternateRaw: Array<string | null | undefined> = [
    ...attachment.candidates,
    subjectName,
    bodyName,
    ...(input.aiAlternateProjectNames ?? []),
    projectNameSource === "attachment" ? subjectName : null,
    projectNameSource === "attachment" ? bodyName : null,
  ];

  if (attachment.conflicting) {
    alternateRaw.push(...attachment.candidates);
  }

  return {
    projectName,
    projectNameSource,
    alternateProjectNames: dedupeProjectAliases(
      projectName,
      alternateRaw,
      customerCompanyName
    ),
  };
}
