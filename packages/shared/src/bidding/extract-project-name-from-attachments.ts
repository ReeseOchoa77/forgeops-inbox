import { normalizeName } from "../reference/normalize.js";

/** Filenames that identify a document type only — never a project. */
const GENERIC_DOCUMENT_BASENAME =
  /^(?:a\d{1,4}[a-z]?|s\d{1,4}[a-z]?|m\d{1,4}[a-z]?|e\d{1,4}[a-z]?|p\d{1,4}[a-z]?|rfi\s*\d+|asi\s*\d+|addendum\s*\d+|addenda|proposal|quote|estimate|invoice|bid\s*form|instructions?\s+to\s+bidders?|project\s+manual|specifications?|structural\s+drawings?|architectural\s+drawings?|mechanical\s+drawings?|electrical\s+drawings?|drawings?|plans?|plan\s*set|bid\s*set|bid\s*documents?|bid\s*package|construction\s+documents?|cd\s*set|issued\s+for\s+bid|ifb|cover\s*sheet|title\s*sheet|bid\s*invite|bid\s*invitation|invitation\s+to\s+bid|itb|request\s+for\s+(?:bid|quote|proposal)|rf[bpq])$/i;

/**
 * Document-purpose wrappers — describe THE DOCUMENT, not THE PROJECT.
 */
export const DOCUMENT_PURPOSE_WRAPPER_PATTERN =
  /\b(?:bid\s+invit(?:e|ation)|invitation\s+to\s+bid|invite\s+to\s+bid|request\s+for\s+(?:bid|quote|proposal)|bid\s+documents?|bid\s+package|bid\s+set|plan\s+set|construction\s+documents?|architectural\s+drawings?|structural\s+drawings?|mechanical\s+drawings?|electrical\s+drawings?|civil\s+drawings?|project\s+manual|specifications?|issued\s+for\s+bid|addend(?:um|a)(?:\s*\d+)?|proposal|quote|estimate|bid\s+form|itb|rfq|rfp|rfb|ifb|cd\s*set)\b/gi;

const DOCUMENT_PURPOSE_TEST =
  /\b(?:bid\s+invit(?:e|ation)|invitation\s+to\s+bid|invite\s+to\s+bid|request\s+for\s+(?:bid|quote|proposal)|bid\s+documents?|bid\s+package|bid\s+set|plan\s+set|construction\s+documents?|architectural\s+drawings?|structural\s+drawings?|mechanical\s+drawings?|electrical\s+drawings?|civil\s+drawings?|project\s+manual|specifications?|issued\s+for\s+bid|addend(?:um|a)(?:\s*\d+)?|proposal|quote|estimate|bid\s+form|\bitb\b|\brfq\b|\brfp\b|\brfb\b|\bifb\b|cd\s*set)\b/i;

/** Trailing document-type / revision suffixes (with or without separators). */
const DOCUMENT_TYPE_SUFFIXES: RegExp[] = [
  /\s*[-–—_|]\s*(?:architectural|structural|mechanical|electrical|civil)\s+(?:drawings?|plans?|set)\s*$/i,
  /\s+(?:architectural|structural|mechanical|electrical|civil)\s+(?:drawings?|plans?|set)\s*$/i,
  /\s*[-–—_|]\s*(?:architectural|structural|mechanical|electrical|civil)\s*$/i,
  /\s*[-–—_|]\s*(?:bid\s*set|plan\s*set|plans?|drawings?|construction\s+documents?|cd\s*set|bid\s*documents?|bid\s*package|(?:architectural|structural|mechanical|electrical|civil)\s+set)\s*$/i,
  /\s+(?:bid\s*set|plan\s*set|construction\s+documents?|cd\s*set|bid\s*documents?|bid\s*package|(?:architectural|structural|mechanical|electrical|civil)\s+set)\s*$/i,
  /\s*[-–—_|]\s*(?:issued\s+for\s+bid|ifb|specifications?|project\s+manual|specs?)\s*$/i,
  /\s+(?:issued\s+for\s+bid|ifb|specifications?|project\s+manual|specs?)\s*$/i,
  /\s*[-–—_|]\s*(?:sheet\s*)?\d{1,4}[a-z]?\s*$/i,
  /\s*[-–—_|]\s*(?:rev(?:ision)?\.?\s*\d+|v\d+)\s*$/i,
  /\s*[-–—_|]\s*(?:addend(?:um|a)(?:\s*\d+)?)\s*$/i,
];

const DRAWING_HINT =
  /\b(?:drawings?|plans?|plan\s*set|bid\s*set|construction\s+documents?|cd\s*set|architectural|structural|issued\s+for\s+bid|ifb|bid\s+invite|bid\s+invitation|invitation\s+to\s+bid|itb|specifications?|project\s+manual|addend(?:um|a)|bid\s+package|bid\s+documents?)\b/i;

const WRAPPER_ONLY_SEGMENT =
  /^(?:bid\s+invit(?:e|ation)|invitation\s+to\s+bid|invite\s+to\s+bid|itb|rf[bpq]|request\s+for\s+(?:bid|quote|proposal)|bid\s+documents?|bid\s+package|bid\s+set|plan\s+set|construction\s+documents?|architectural(?:\s+(?:drawings?|plans?|set))?|structural(?:\s+(?:drawings?|plans?|set))?|mechanical(?:\s+(?:drawings?|plans?|set))?|electrical(?:\s+(?:drawings?|plans?|set))?|civil(?:\s+(?:drawings?|plans?|set))?|specifications?|project\s+manual|addend(?:um|a)(?:\s*\d+)?|proposal|quote|estimate|bid\s+form|issued\s+for\s+bid|ifb|cd\s*set|drawings?|plans?)$/i;

/** Light synonym expansion for multi-file identity compare only. */
const COMPARE_SYNONYMS: Array<[RegExp, string]> = [
  [/\bapts?\b/g, "apartments"],
  [/\belem(?:entary)?\b/g, "elementary"],
  [/\bhs\b/g, "high school"],
  [/\bms\b/g, "middle school"],
  [/\bsch\b/g, "school"],
  [/\bbldg\b/g, "building"],
  [/\bproj\b/g, "project"],
];

export function isPdfAttachmentFilename(filename: string): boolean {
  const t = filename.trim();
  if (!t) return false;
  return /\.pdf$/i.test(t);
}

export function stripPdfExtension(filename: string): string {
  return filename.trim().replace(/\.pdf$/i, "").trim();
}

/**
 * True when the basename (no extension) is a generic document label / sheet code.
 */
export function isGenericDocumentBasename(basename: string): boolean {
  const t = basename.trim().replace(/\s+/g, " ");
  if (!t) return true;
  if (GENERIC_DOCUMENT_BASENAME.test(t)) return true;
  if (/^[A-Z]\s*[-.]?\s*\d{1,4}[A-Z]?$/i.test(t)) return true;
  return false;
}

function containsDocumentPurposeWrapper(text: string): boolean {
  return DOCUMENT_PURPOSE_TEST.test(text);
}

/**
 * True when a candidate still looks like a document wrapper / company+invite composite.
 */
export function looksLikeDocumentWrapperTitle(name: string): boolean {
  const t = name.trim().replace(/\s+/g, " ");
  if (!t) return true;
  if (WRAPPER_ONLY_SEGMENT.test(t)) return true;
  if (containsDocumentPurposeWrapper(t) && !/[–—-]/.test(t)) {
    const withoutWrapper = stripDocumentPurposePhrases(t);
    if (!withoutWrapper || withoutWrapper.split(/\s+/).length <= 2) return true;
  }
  return false;
}

/**
 * Strip obvious document-type / revision suffixes. Conservative — stops when empty.
 */
export function stripDocumentTypeSuffixes(basename: string): string {
  let cleaned = basename.trim().replace(/\s+/g, " ");
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    for (const pattern of DOCUMENT_TYPE_SUFFIXES) {
      cleaned = cleaned.replace(pattern, "").trim();
    }
  }
  return cleaned.replace(/^[-–—_|:\s]+|[-–—_|:\s]+$/g, "").trim();
}

/**
 * Remove document-purpose phrases from a string (keeps surrounding project text).
 */
export function stripDocumentPurposePhrases(text: string): string {
  let cleaned = text.trim().replace(/\s+/g, " ");
  cleaned = cleaned.replace(DOCUMENT_PURPOSE_WRAPPER_PATTERN, " ").trim();
  cleaned = cleaned
    .replace(/\s*[-–—_|/]+\s*/g, " - ")
    .replace(/(?:\s*-\s*)+/g, " - ")
    .replace(/^[-–—_|:\s]+|[-–—_|:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function looksLikeCredibleProjectTitle(name: string): boolean {
  const t = name.trim();
  if (t.length < 3 || t.length > 300) return false;
  if (isGenericDocumentBasename(t)) return false;
  if (looksLikeDocumentWrapperTitle(t)) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  if (DRAWING_HINT.test(t) && stripDocumentTypeSuffixes(t).length < 3) return false;
  if (containsDocumentPurposeWrapper(t)) return false;
  const normalized = normalizeName(t);
  if (!normalized || normalized.length < 3) return false;
  return true;
}

function splitFilenameSegments(basename: string): string[] {
  return basename
    .split(/\s*[-–—_|]\s*/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingCompany(
  project: string,
  customerCompanyName?: string | null
): string {
  const customer = customerCompanyName?.trim() ?? "";
  if (!customer) return project;
  const customerNorm = normalizeName(customer);
  const pNorm = normalizeName(project);
  if (!customerNorm || !pNorm) return project;
  if (pNorm === customerNorm) return project;
  if (!pNorm.startsWith(customerNorm + " ") && !pNorm.startsWith(customerNorm)) {
    return project;
  }
  const stripped = project
    .replace(new RegExp(`^${escapeRegExp(customer)}\\s*[-–—,:]?\\s*`, "i"), "")
    .trim();
  return looksLikeCredibleProjectTitle(stripped) ? stripped : project;
}

/**
 * Extract project identity from compound filenames such as:
 * "CoBeck Bid Invite -Prieto Battery"
 * "Mortenson - Bid Invite - Central Middle School Addition"
 * "Greiner Construction ITB - North Loop Apartments"
 *
 * Company names are inferred structurally (left of wrappers / first short segment),
 * never from a hard-coded contractor list.
 */
export function extractProjectFromCompoundFilename(
  basename: string,
  customerCompanyName?: string | null
): { projectName: string | null; ambiguous: boolean; companyHint: string | null } {
  const normalizedSpacing = basename
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([-–—_|])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();

  const segments = splitFilenameSegments(normalizedSpacing);
  const customerNorm = normalizeName(customerCompanyName?.trim() ?? "");

  // —— Pattern: left contains document wrapper, right is project ——
  // "CoBeck Bid Invite - Prieto Battery"
  // "Greiner Construction ITB - North Loop Apartments"
  if (segments.length === 2) {
    const left = segments[0]!;
    const right = segments[1]!;
    const leftHasWrapper =
      WRAPPER_ONLY_SEGMENT.test(left) || containsDocumentPurposeWrapper(left);
    const rightHasWrapper =
      WRAPPER_ONLY_SEGMENT.test(right) || containsDocumentPurposeWrapper(right);

    if (leftHasWrapper && !rightHasWrapper && looksLikeCredibleProjectTitle(right)) {
      const companyHint = stripDocumentPurposePhrases(left) || null;
      return {
        projectName: stripLeadingCompany(right, customerCompanyName).slice(0, 300),
        ambiguous: false,
        companyHint,
      };
    }

    // "Prieto Battery - Structural Drawings" handled by suffix strip; if right is
    // wrapper-only, left is project.
    if (
      !leftHasWrapper &&
      (WRAPPER_ONLY_SEGMENT.test(right) || containsDocumentPurposeWrapper(right)) &&
      looksLikeCredibleProjectTitle(left)
    ) {
      return {
        projectName: stripLeadingCompany(left, customerCompanyName).slice(0, 300),
        ambiguous: false,
        companyHint: null,
      };
    }

    // Company - Project when customer evidence matches left
    if (
      customerNorm &&
      !leftHasWrapper &&
      !rightHasWrapper &&
      looksLikeCredibleProjectTitle(right)
    ) {
      const leftNorm = normalizeName(left);
      if (
        leftNorm &&
        (leftNorm === customerNorm ||
          customerNorm.includes(leftNorm) ||
          leftNorm.includes(customerNorm))
      ) {
        return {
          projectName: right.slice(0, 300),
          ambiguous: false,
          companyHint: left,
        };
      }
    }
  }

  // —— Pattern: 3+ segments ——
  // Invite-style: "Mortenson - Bid Invite - Central Middle School Addition"
  //   → drop company + wrapper, keep project
  // Drawing-style: "Forte - EP Office Expansion - Architectural Drawings"
  //   → keep all non-wrapper segments joined (Forte is project brand, not GC)
  if (segments.length >= 3) {
    const nonWrapper = segments.filter((s) => !WRAPPER_ONLY_SEGMENT.test(s));
    const hasWrapperSeg = segments.some((s) => WRAPPER_ONLY_SEGMENT.test(s));
    const hasInviteStyleWrapper = segments.some((s) =>
      /^(?:bid\s+invit(?:e|ation)|invitation\s+to\s+bid|invite\s+to\s+bid|itb|rf[bpq]|request\s+for\s+(?:bid|quote|proposal))$/i.test(
        s
      )
    );
    if (hasWrapperSeg && nonWrapper.length >= 1) {
      let project: string;
      let companyHint: string | null = null;
      if (hasInviteStyleWrapper && nonWrapper.length >= 2) {
        companyHint = nonWrapper[0]!;
        project = nonWrapper[nonWrapper.length - 1]!;
        // Also drop leading company when customer evidence agrees
        if (customerNorm) {
          const firstNorm = normalizeName(companyHint);
          if (
            firstNorm &&
            (firstNorm === customerNorm ||
              customerNorm.includes(firstNorm) ||
              firstNorm.includes(customerNorm))
          ) {
            project = nonWrapper[nonWrapper.length - 1]!;
          }
        }
      } else {
        project = nonWrapper.join(" - ");
      }
      project = stripLeadingCompany(project, customerCompanyName);
      if (looksLikeCredibleProjectTitle(project)) {
        return {
          projectName: project.slice(0, 300),
          ambiguous: false,
          companyHint,
        };
      }
    }
  }

  // —— Unsegmented / fallback: strip purpose phrases + suffixes ——
  let cleaned = stripDocumentTypeSuffixes(normalizedSpacing);
  const beforePurpose = cleaned;
  cleaned = stripDocumentPurposePhrases(cleaned);
  cleaned = stripDocumentTypeSuffixes(cleaned);
  cleaned = stripLeadingCompany(cleaned, customerCompanyName);

  if (looksLikeCredibleProjectTitle(cleaned)) {
    // If wrappers were present and stripping did not isolate a cleaner core,
    // mark ambiguous so we do not lock the noisy filename as the Job name.
    const hadWrapper = containsDocumentPurposeWrapper(normalizedSpacing);
    const ambiguous =
      hadWrapper &&
      normalizeName(cleaned) === normalizeName(beforePurpose) &&
      containsDocumentPurposeWrapper(cleaned);
    if (ambiguous) {
      return { projectName: null, ambiguous: true, companyHint: null };
    }
    return {
      projectName: cleaned.slice(0, 300),
      ambiguous: false,
      companyHint: null,
    };
  }

  if (containsDocumentPurposeWrapper(normalizedSpacing)) {
    return { projectName: null, ambiguous: true, companyHint: null };
  }

  return { projectName: null, ambiguous: false, companyHint: null };
}

/**
 * Extract a project-name candidate from a single PDF filename, or null.
 * Ambiguous company+wrapper composites return null (AI / subject / body decide).
 */
export function extractProjectCandidateFromPdfFilename(
  filename: string | null | undefined,
  customerCompanyName?: string | null
): string | null {
  const raw = (filename ?? "").trim();
  if (!raw || !isPdfAttachmentFilename(raw)) return null;
  const basename = stripPdfExtension(raw);
  if (isGenericDocumentBasename(basename)) return null;

  const compound = extractProjectFromCompoundFilename(
    basename,
    customerCompanyName
  );
  if (compound.projectName) {
    return compound.projectName;
  }
  if (compound.ambiguous) return null;

  // Fast path: trailing drawing suffixes
  const stripped = stripDocumentTypeSuffixes(basename);
  if (
    stripped &&
    stripped.length < basename.length &&
    looksLikeCredibleProjectTitle(stripped)
  ) {
    return stripLeadingCompany(stripped, customerCompanyName).slice(0, 300);
  }

  if (!stripped || isGenericDocumentBasename(stripped)) return null;
  if (!looksLikeCredibleProjectTitle(stripped)) return null;

  const hadDocSuffix = stripped.length < basename.length;
  const tokenCount = stripped.split(/\s+/).filter(Boolean).length;
  if (!hadDocSuffix && tokenCount < 2 && !DRAWING_HINT.test(basename)) {
    return null;
  }
  if (!hadDocSuffix && tokenCount === 1) return null;
  if (containsDocumentPurposeWrapper(stripped)) return null;

  return stripLeadingCompany(stripped, customerCompanyName).slice(0, 300);
}

export type AttachmentProjectEvidence = {
  /** Winning shared candidate, or null when none / conflicting / ambiguous. */
  projectName: string | null;
  /** Distinct credible candidates found across PDFs (for alias / conflict handling). */
  candidates: string[];
  /** True when 2+ distinct project identities conflict. */
  conflicting: boolean;
  /**
   * True when filenames look compound/noisy and deterministic should not
   * lock a name — AI + subject/body should reason instead.
   */
  ambiguous: boolean;
};

function normalizeForProjectCompare(name: string): string {
  let n = normalizeName(name);
  for (const [re, replacement] of COMPARE_SYNONYMS) {
    n = n.replace(re, replacement);
  }
  return n.replace(/\s+/g, " ").trim();
}

function tokenSet(name: string): Set<string> {
  return new Set(
    normalizeForProjectCompare(name)
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

/** Jaccard similarity on compare-normalized tokens. */
function tokenSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function sameProjectIdentity(a: string, b: string): boolean {
  const na = normalizeForProjectCompare(a);
  const nb = normalizeForProjectCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = na.length <= nb.length ? na : nb;
    if (shorter.split(/\s+/).length >= 2 || shorter.length >= 8) return true;
  }
  return tokenSimilarity(a, b) >= 0.6;
}

function pickCanonicalForm(names: string[]): string {
  return [...names].sort((a, b) => {
    const len = b.length - a.length;
    if (len !== 0) return len;
    return a.localeCompare(b);
  })[0]!;
}

/**
 * Resolve project identity across multiple PDF attachment filenames.
 * Uses semantic agreement (containment / token overlap), not only exact equality.
 */
export function extractProjectIdentityFromPdfFilenames(
  filenames: Array<string | null | undefined>,
  customerCompanyName?: string | null
): AttachmentProjectEvidence {
  /** Distinct surface forms (keep Apts vs Apartments for aliases). */
  const candidates: string[] = [];
  let anyAmbiguous = false;

  for (const filename of filenames) {
    const raw = (filename ?? "").trim();
    if (!raw || !isPdfAttachmentFilename(raw)) continue;
    const basename = stripPdfExtension(raw);
    if (isGenericDocumentBasename(basename)) continue;

    const compound = extractProjectFromCompoundFilename(
      basename,
      customerCompanyName
    );
    if (compound.ambiguous && !compound.projectName) anyAmbiguous = true;

    const candidate = extractProjectCandidateFromPdfFilename(
      raw,
      customerCompanyName
    );
    if (!candidate) continue;

    // Dedupe only exact normalize — keep semantic variants as alias forms
    const exactDupe = candidates.some(
      (c) => normalizeName(c) === normalizeName(candidate)
    );
    if (!exactDupe) candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return {
      projectName: null,
      candidates: [],
      conflicting: false,
      ambiguous: anyAmbiguous,
    };
  }

  const clusters: string[][] = [];
  for (const candidate of candidates) {
    let placed = false;
    for (const cluster of clusters) {
      if (cluster.some((c) => sameProjectIdentity(c, candidate))) {
        cluster.push(candidate);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([candidate]);
  }

  if (clusters.length > 1) {
    return {
      projectName: null,
      candidates,
      conflicting: true,
      ambiguous: anyAmbiguous,
    };
  }

  const cluster = clusters[0]!;
  return {
    projectName: pickCanonicalForm(cluster),
    candidates: cluster,
    conflicting: false,
    ambiguous: false,
  };
}
