import { normalizeName } from "../reference/normalize.js";

/** Filenames that identify a document type only — never a project. */
const GENERIC_DOCUMENT_BASENAME =
  /^(?:a\d{1,4}[a-z]?|s\d{1,4}[a-z]?|m\d{1,4}[a-z]?|e\d{1,4}[a-z]?|p\d{1,4}[a-z]?|rfi\s*\d+|asi\s*\d+|addendum\s*\d+|proposal|quote|estimate|invoice|bid\s*form|instructions?\s+to\s+bidders?|project\s+manual|specifications?|structural\s+drawings?|architectural\s+drawings?|mechanical\s+drawings?|electrical\s+drawings?|drawings?|plans?|plan\s*set|bid\s*set|construction\s+documents?|cd\s*set|issued\s+for\s+bid|ifb|cover\s*sheet|title\s*sheet)$/i;

/** Trailing document-type suffixes safe to strip from project-identifying names. */
const DOCUMENT_TYPE_SUFFIXES: RegExp[] = [
  /\s*[-–—_|]\s*(?:architectural|structural|mechanical|electrical|civil)\s+(?:drawings?|plans?)\s*$/i,
  /\s*[-–—_|]\s*(?:architectural|structural|mechanical|electrical|civil)\s*$/i,
  /\s*[-–—_|]\s*(?:bid\s*set|plan\s*set|plans?|drawings?|construction\s+documents?|cd\s*set)\s*$/i,
  /\s*[-–—_|]\s*(?:issued\s+for\s+bid|ifb|specifications?|project\s+manual|specs?)\s*$/i,
  /\s*[-–—_|]\s*(?:sheet\s*)?\d{1,4}[a-z]?\s*$/i,
  /\s*[-–—_|]\s*(?:rev(?:ision)?\.?\s*\d+|v\d+)\s*$/i,
];

const DRAWING_HINT =
  /\b(?:drawings?|plans?|plan\s*set|bid\s*set|construction\s+documents?|cd\s*set|architectural|structural|issued\s+for\s+bid|ifb)\b/i;

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
  // Bare sheet codes like "A-101", "S.001"
  if (/^[A-Z]\s*[-.]?\s*\d{1,4}[A-Z]?$/i.test(t)) return true;
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

function looksLikeCredibleProjectTitle(name: string): boolean {
  const t = name.trim();
  if (t.length < 3 || t.length > 300) return false;
  if (isGenericDocumentBasename(t)) return false;
  // Need at least one letter
  if (!/[a-zA-Z]/.test(t)) return false;
  // Reject if only drawing-type vocabulary remains
  if (DRAWING_HINT.test(t) && stripDocumentTypeSuffixes(t).length < 3) return false;
  const normalized = normalizeName(t);
  if (!normalized || normalized.length < 3) return false;
  return true;
}

/**
 * Extract a project-name candidate from a single PDF filename, or null.
 */
export function extractProjectCandidateFromPdfFilename(
  filename: string | null | undefined
): string | null {
  const raw = (filename ?? "").trim();
  if (!raw || !isPdfAttachmentFilename(raw)) return null;
  const basename = stripPdfExtension(raw);
  if (isGenericDocumentBasename(basename)) return null;

  const stripped = stripDocumentTypeSuffixes(basename);
  if (!stripped || isGenericDocumentBasename(stripped)) return null;
  if (!looksLikeCredibleProjectTitle(stripped)) return null;

  // Prefer names that had a document-type suffix (stronger drawing evidence),
  // OR that look like multi-token project titles (not bare codes).
  const hadDocSuffix = stripped.length < basename.length;
  const tokenCount = stripped.split(/\s+/).filter(Boolean).length;
  if (!hadDocSuffix && tokenCount < 2 && !DRAWING_HINT.test(basename)) {
    // "Project Alpha.pdf" with no drawing hint — still allow multi-token; single token alone is weak
    return null;
  }
  if (!hadDocSuffix && tokenCount === 1) return null;

  return stripped.slice(0, 300);
}

export type AttachmentProjectEvidence = {
  /** Winning shared candidate, or null when none / conflicting. */
  projectName: string | null;
  /** Distinct credible candidates found across PDFs (for alias / conflict handling). */
  candidates: string[];
  /** True when 2+ distinct normalized project identities conflict. */
  conflicting: boolean;
};

/**
 * Resolve project identity across multiple PDF attachment filenames.
 * Reinforces a common name; returns null + conflicting when identities disagree.
 */
export function extractProjectIdentityFromPdfFilenames(
  filenames: Array<string | null | undefined>
): AttachmentProjectEvidence {
  const candidates: string[] = [];
  const byNormalized = new Map<string, string>();

  for (const filename of filenames) {
    const candidate = extractProjectCandidateFromPdfFilename(filename ?? "");
    if (!candidate) continue;
    const n = normalizeName(candidate);
    if (!n) continue;
    if (!byNormalized.has(n)) {
      byNormalized.set(n, candidate);
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    return { projectName: null, candidates: [], conflicting: false };
  }
  if (candidates.length === 1) {
    return {
      projectName: candidates[0]!,
      candidates,
      conflicting: false,
    };
  }

  // Multiple distinct normalized names → conflict; do not pick arbitrarily.
  return {
    projectName: null,
    candidates,
    conflicting: true,
  };
}
