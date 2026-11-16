/**
 * V2.4 Attachment Identity — deterministic project evidence from attachments.
 *
 * Operates on pre-loaded attachment payloads (filename + cached extracted text).
 * Does not download, OCR, or call AI. Extraction status is recorded so evals
 * never pretend unread attachments were checked.
 */

import type { JobMatchEvidence, JobMatchEvidenceType } from "./job-matcher.js";
import {
  canonicalizeJobNameTokens,
  isDistinguishingJobNameToken,
  isJobNameContentToken,
  isNumericJobNameToken,
  phraseContained,
} from "./job-name-normalize.js";
import {
  buildContextualFamilyIndex,
  canonicalizeContextualToken,
  contextualTokensEquivalent,
  extractContextualIdentityTerms,
  isContextualWeakDistinguishingToken,
  isTokenIncidentalInContextualHay,
  isTokenNegatedInContextualHay,
} from "./job-contextual-word-search.js";
import {
  extractCompoundNumericIdentities,
  extractFamilyScopedNumericIdentities,
  extractPeerCompoundNumericIdentities,
  findNumericIdentityConflicts,
  isCompoundNumericKey,
  resolveCompoundDescriptor,
  resolveFamilyScopedNumericPeer,
} from "./job-contextual-compound-numeric.js";
import type { IdentityPeerJob } from "./job-name-identity-policy.js";

export const JOB_ATTACHMENT_IDENTITY_MARKER_VERSION =
  "job-attachment-identity-v1" as const;

export type AttachmentExtractStatus =
  | "READY"
  | "PARTIAL"
  | "UNSUPPORTED"
  | "UNAVAILABLE"
  | "FAILED"
  | "PENDING"
  | "NONE";

export type JobAttachmentForMatch = {
  attachmentId: string;
  filename: string;
  mimeType?: string | null;
  /** Cached extracted text (PDF text layer / prior pipeline). */
  extractedText?: string | null;
  extractStatus: AttachmentExtractStatus;
  /** Optional page samples already selected by the extract pipeline. */
  pageTexts?: Array<{ pageNumber: number; text: string }>;
  metadataProjectName?: string | null;
};

export type AttachmentIdentityEvidenceCategory =
  | "ATTACHMENT_TITLE_BLOCK_PROJECT"
  | "ATTACHMENT_DOCUMENT_HEADER_PROJECT"
  | "ATTACHMENT_FILENAME_PROJECT"
  | "ATTACHMENT_METADATA_PROJECT"
  | "ATTACHMENT_BODY_PROJECT_REFERENCE"
  | "ATTACHMENT_INCIDENTAL_REFERENCE"
  | "ATTACHMENT_NEGATED_REFERENCE";

export type AttachmentIdentityHit = {
  jobId: string;
  attachmentId: string;
  filename: string;
  category: AttachmentIdentityEvidenceCategory;
  matchedPhrase: string;
  supportingExcerpt: string;
  pageNumber: number | null;
  strength: "STRONG" | "WEAK";
};

export type AttachmentIdentityDiagnostics = {
  marker: "ATTACHMENT";
  attachmentsPresent: boolean;
  attachmentsProcessed: number;
  attachmentsPending: number;
  attachmentsFailed: number;
  attachmentsUnsupported: number;
  attachmentsUnavailable: number;
  hits: AttachmentIdentityHit[];
  extractionComplete: boolean;
  extractionRevision: string;
  aiInvoked: boolean;
  reason:
    | "ATTACHMENT_IDENTITY_MATCH"
    | "ATTACHMENT_IDENTITY_AMBIGUOUS"
    | "ATTACHMENT_IDENTITY_CONFLICT"
    | "ATTACHMENT_EXTRACTION_UNAVAILABLE"
    | "NO_ATTACHMENT_EVIDENCE"
    | "NO_ATTACHMENTS";
};

export type AttachmentIdentityMarkerResult = {
  status: "MATCH" | "AMBIGUOUS" | "CONFLICT" | "NO_MATCH";
  selectedJobId: string | null;
  candidateJobIds: string[];
  evidence: JobMatchEvidence[];
  diagnostics: AttachmentIdentityDiagnostics;
  /** Narrowing strength for the pipeline. */
  laterStrength: "ABSENT" | "WEAK" | "STRONG";
  markerVersion: string;
};

const TITLE_BLOCK_PATTERNS = [
  /(?:^|\n)\s*(?:project(?:\s*name)?|job(?:\s*name)?)\s*[:\-–—]\s*(.+)$/gim,
  /(?:^|\n)\s*PROJECT\s*[:\-–—]\s*(.+)$/gim,
];

const HEADER_PATTERNS = [
  /(?:^|\n)\s*(?:regarding|re|subject)\s*[:\-–—]\s*(.+)$/gim,
];

const EXTRACTION_REVISION = "attachment-identity-extract-r1";

function pushEvidence(
  list: JobMatchEvidence[],
  type: JobMatchEvidenceType,
  value: string,
  confidence: number
): void {
  list.push({ type, value: value.slice(0, 200), confidence });
}

function peerPhrases(peer: IdentityPeerJob): string[][] {
  if (peer.phraseTokenLists.length > 0) return peer.phraseTokenLists;
  return [peer.contentTokens];
}

function phraseIsAuthoritative(tokens: string[]): boolean {
  const content = tokens.filter(
    (t) =>
      isJobNameContentToken(t) ||
      isDistinguishingJobNameToken(t) ||
      isNumericJobNameToken(t)
  );
  if (content.length === 0) return false;
  // Standalone numbers are never attachment identity by themselves.
  if (content.length === 1 && isNumericJobNameToken(content[0]!)) {
    return false;
  }
  if (
    content.length === 1 &&
    isContextualWeakDistinguishingToken(content[0]!)
  ) {
    return false;
  }
  return true;
}

function findPhraseInTokens(
  hay: string[],
  phrase: string[]
): { start: number } | null {
  const content = phrase.filter(
    (t) =>
      isJobNameContentToken(t) ||
      isDistinguishingJobNameToken(t) ||
      isNumericJobNameToken(t)
  );
  if (!phraseIsAuthoritative(content)) return null;
  for (let i = 0; i <= hay.length - content.length; i += 1) {
    let ok = true;
    for (let j = 0; j < content.length; j += 1) {
      const needle = content[j]!;
      const hayTok = hay[i + j]!;
      if (isNumericJobNameToken(needle)) {
        if (!isNumericJobNameToken(hayTok) || hayTok !== needle) {
          ok = false;
          break;
        }
        const prev = j > 0 ? content[j - 1]! : null;
        if (
          !prev ||
          !resolveCompoundDescriptor(prev) ||
          !resolveCompoundDescriptor(hay[i + j - 1]!)
        ) {
          ok = false;
          break;
        }
        continue;
      }
      if (!contextualTokensEquivalent(hayTok, needle)) {
        ok = false;
        break;
      }
    }
    if (ok) return { start: i };
  }
  return null;
}

/** "See X for an example" / "example of X" — not current-project identity. */
function isAttachmentExampleReference(
  hay: readonly string[],
  tokenIndex: number
): boolean {
  const left = hay.slice(Math.max(0, tokenIndex - 4), tokenIndex);
  const right = hay.slice(tokenIndex + 1, tokenIndex + 5);
  const cues = new Set(["example", "examples", "similar", "typical", "sample"]);
  if (left.some((t) => t === "see" || t === "like" || cues.has(t))) return true;
  if (right.some((t) => cues.has(t))) return true;
  return false;
}

function excerptAround(text: string, needle: string, max = 120): string {
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const idx = lower.indexOf(n);
  if (idx < 0) return needle.slice(0, max);
  const start = Math.max(0, idx - 40);
  return text.slice(start, start + max).trim();
}

function matchPeersInText(input: {
  text: string;
  peers: readonly IdentityPeerJob[];
  attachmentId: string;
  filename: string;
  category: AttachmentIdentityEvidenceCategory;
  pageNumber: number | null;
  strength: "STRONG" | "WEAK";
  features?: {
    enableUniqueProjectTerms?: boolean;
    enableFamilyScopedNumeric?: boolean;
  };
}): AttachmentIdentityHit[] {
  const tokens = canonicalizeJobNameTokens(input.text);
  if (tokens.length === 0) return [];
  const hayCompounds = extractCompoundNumericIdentities(tokens);
  const hits: AttachmentIdentityHit[] = [];
  for (const peer of input.peers) {
    let hitForPeer = false;
    for (const phrase of peerPhrases(peer)) {
      const found = findPhraseInTokens(tokens, phrase);
      if (!found) continue;
      const incidental =
        isTokenIncidentalInContextualHay(tokens, found.start) ||
        isAttachmentExampleReference(tokens, found.start);
      const negated = isTokenNegatedInContextualHay(tokens, found.start);
      let category = input.category;
      let strength = input.strength;
      if (negated) {
        category = "ATTACHMENT_NEGATED_REFERENCE";
        strength = "WEAK";
      } else if (incidental) {
        category = "ATTACHMENT_INCIDENTAL_REFERENCE";
        strength = "WEAK";
      }
      const matchedPhrase = phrase
        .map((t) => canonicalizeContextualToken(t))
        .join(" ");
      hits.push({
        jobId: peer.jobId,
        attachmentId: input.attachmentId,
        filename: input.filename,
        category,
        matchedPhrase,
        supportingExcerpt: excerptAround(input.text, matchedPhrase),
        pageNumber: input.pageNumber,
        strength,
      });
      hitForPeer = true;
      break;
    }
    if (hitForPeer) continue;

    // Compound numeric identity (Building 3 → building:3) when family word also present.
    const peerCompounds = extractPeerCompoundNumericIdentities(peer);
    if (peerCompounds.length === 0) continue;
    const conflicts = findNumericIdentityConflicts({
      hayCompounds,
      peerCompounds,
    });
    if (conflicts.length > 0) continue;
    const familyTokens = peer.contentTokens.filter(
      (t) =>
        !isNumericJobNameToken(t) &&
        !resolveCompoundDescriptor(t) &&
        !isContextualWeakDistinguishingToken(t)
    );
    const familyPresent = familyTokens.some((ft) =>
      tokens.some((t) => contextualTokensEquivalent(t, ft))
    );
    for (const compound of peerCompounds) {
      const inHay = hayCompounds.find((c) => c.key === compound.key);
      if (!inHay) continue;
      // Require family token OR unique compound among peers.
      const uniqueCompound =
        input.peers.filter((p) =>
          extractPeerCompoundNumericIdentities(p).some(
            (c) => c.key === compound.key
          )
        ).length === 1;
      if (!familyPresent && !uniqueCompound) continue;
      hits.push({
        jobId: peer.jobId,
        attachmentId: input.attachmentId,
        filename: input.filename,
        category: input.category,
        matchedPhrase: compound.key,
        supportingExcerpt: excerptAround(
          input.text,
          inHay.rawTokens.join(" ")
        ),
        pageNumber: input.pageNumber,
        strength: input.strength,
      });
      break;
    }
  }

  const alreadyHit = new Set(hits.map((h) => h.jobId));
  const familyIndex = buildContextualFamilyIndex(input.peers);

  // Family-scoped numeric in attachment text: "Beltline #3" (V3).
  if (input.features?.enableFamilyScopedNumeric) {
    for (const family of familyIndex.families) {
      const scoped = extractFamilyScopedNumericIdentities(
        tokens,
        [family.sharedId],
        contextualTokensEquivalent
      );
      for (const fn of scoped) {
        const resolved = resolveFamilyScopedNumericPeer({
          value: fn.value,
          familyPeers: family.peers,
        });
        if (!resolved) continue;
        if (alreadyHit.has(resolved.peer.jobId)) continue;
        if (isTokenNegatedInContextualHay(tokens, fn.startIndex)) continue;
        if (
          isTokenIncidentalInContextualHay(tokens, fn.startIndex) ||
          isAttachmentExampleReference(tokens, fn.startIndex)
        ) {
          continue;
        }
        hits.push({
          jobId: resolved.peer.jobId,
          attachmentId: input.attachmentId,
          filename: input.filename,
          category: input.category,
          matchedPhrase: resolved.compound.key,
          supportingExcerpt: excerptAround(input.text, fn.rawTokens.join(" ")),
          pageNumber: input.pageNumber,
          strength: input.strength,
        });
        alreadyHit.add(resolved.peer.jobId);
      }
    }
  }

  // Unique project-title terms (e.g. Nova → Nova Classical) (V3).
  if (input.features?.enableUniqueProjectTerms) {
    const sharedKeys = new Set(
      familyIndex.sharedIdentifiers.map((s) => canonicalizeContextualToken(s))
    );
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i]!;
      if (isNumericJobNameToken(tok)) continue;
      if (resolveCompoundDescriptor(tok)) continue;
      if (isContextualWeakDistinguishingToken(tok)) continue;
      const key = canonicalizeContextualToken(tok);
      if (sharedKeys.has(key)) continue;
      const holders = input.peers.filter((p) =>
        extractContextualIdentityTerms(p).some(
          (t) =>
            !isCompoundNumericKey(t) && contextualTokensEquivalent(t, tok)
        )
      );
      if (holders.length !== 1) continue;
      if (alreadyHit.has(holders[0]!.jobId)) continue;
      if (isTokenNegatedInContextualHay(tokens, i)) continue;
      if (
        isTokenIncidentalInContextualHay(tokens, i) ||
        isAttachmentExampleReference(tokens, i)
      ) {
        continue;
      }
      hits.push({
        jobId: holders[0]!.jobId,
        attachmentId: input.attachmentId,
        filename: input.filename,
        category: input.category,
        matchedPhrase: key,
        supportingExcerpt: excerptAround(input.text, tok),
        pageNumber: input.pageNumber,
        strength: input.strength,
      });
      alreadyHit.add(holders[0]!.jobId);
    }
  }
  return hits;
}

function matchFilename(input: {
  filename: string;
  peers: readonly IdentityPeerJob[];
  attachmentId: string;
  features?: {
    enableUniqueProjectTerms?: boolean;
    enableFamilyScopedNumeric?: boolean;
  };
}): AttachmentIdentityHit[] {
  const base = input.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  return matchPeersInText({
    text: base,
    peers: input.peers,
    attachmentId: input.attachmentId,
    filename: input.filename,
    category: "ATTACHMENT_FILENAME_PROJECT",
    pageNumber: null,
    strength: "WEAK",
    ...(input.features ? { features: input.features } : {}),
  });
}

function extractLabeledProjectLines(
  text: string,
  patterns: RegExp[]
): string[] {
  const out: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const v = m[1]?.trim().split(/\n/)[0]?.trim();
      if (v && v.length >= 2 && v.length <= 200) out.push(v);
    }
  }
  return out;
}

/**
 * Deterministic Attachment Identity over preloaded attachment payloads.
 */
export function runJobAttachmentIdentityMarker(input: {
  attachments: readonly JobAttachmentForMatch[];
  peers: readonly IdentityPeerJob[];
  /** When true, attachments exist on the email but were not loaded. */
  attachmentsPresentButNotLoaded?: boolean;
  /** V3 features; frozen V2.4 omits unique-term / family-scoped numeric. */
  features?: {
    enableUniqueProjectTerms?: boolean;
    enableFamilyScopedNumeric?: boolean;
  };
}): AttachmentIdentityMarkerResult {
  const emptyDiag = (
    reason: AttachmentIdentityDiagnostics["reason"],
    extras?: Partial<AttachmentIdentityDiagnostics>
  ): AttachmentIdentityDiagnostics => ({
    marker: "ATTACHMENT",
    attachmentsPresent:
      input.attachments.length > 0 ||
      Boolean(input.attachmentsPresentButNotLoaded),
    attachmentsProcessed: 0,
    attachmentsPending: 0,
    attachmentsFailed: 0,
    attachmentsUnsupported: 0,
    attachmentsUnavailable: 0,
    hits: [],
    extractionComplete: true,
    extractionRevision: EXTRACTION_REVISION,
    aiInvoked: false,
    reason,
    ...extras,
  });

  if (input.attachmentsPresentButNotLoaded) {
    return {
      status: "NO_MATCH",
      selectedJobId: null,
      candidateJobIds: [],
      evidence: [],
      diagnostics: emptyDiag("ATTACHMENT_EXTRACTION_UNAVAILABLE", {
        attachmentsPresent: true,
        attachmentsUnavailable: 1,
        extractionComplete: false,
      }),
      laterStrength: "ABSENT",
      markerVersion: JOB_ATTACHMENT_IDENTITY_MARKER_VERSION,
    };
  }

  if (input.attachments.length === 0) {
    return {
      status: "NO_MATCH",
      selectedJobId: null,
      candidateJobIds: [],
      evidence: [],
      diagnostics: emptyDiag("NO_ATTACHMENTS"),
      laterStrength: "ABSENT",
      markerVersion: JOB_ATTACHMENT_IDENTITY_MARKER_VERSION,
    };
  }

  let processed = 0;
  let pending = 0;
  let failed = 0;
  let unsupported = 0;
  let unavailable = 0;
  const hits: AttachmentIdentityHit[] = [];

  for (const att of input.attachments) {
    switch (att.extractStatus) {
      case "PENDING":
        pending += 1;
        break;
      case "FAILED":
        failed += 1;
        break;
      case "UNSUPPORTED":
        unsupported += 1;
        break;
      case "UNAVAILABLE":
      case "NONE":
        unavailable += 1;
        break;
      case "READY":
      case "PARTIAL":
        processed += 1;
        break;
      default:
        unavailable += 1;
    }

    const featureOpts = input.features ? { features: input.features } : {};

    // Filename always inspected (cheap).
    hits.push(
      ...matchFilename({
        filename: att.filename,
        peers: input.peers,
        attachmentId: att.attachmentId,
        ...featureOpts,
      })
    );

    if (att.metadataProjectName?.trim()) {
      hits.push(
        ...matchPeersInText({
          text: att.metadataProjectName,
          peers: input.peers,
          attachmentId: att.attachmentId,
          filename: att.filename,
          category: "ATTACHMENT_METADATA_PROJECT",
          pageNumber: null,
          strength: "STRONG",
          ...featureOpts,
        })
      );
    }

    const text = (att.extractedText ?? "").trim();
    if (!text) continue;

    for (const labeled of extractLabeledProjectLines(text, TITLE_BLOCK_PATTERNS)) {
      hits.push(
        ...matchPeersInText({
          text: labeled,
          peers: input.peers,
          attachmentId: att.attachmentId,
          filename: att.filename,
          category: "ATTACHMENT_TITLE_BLOCK_PROJECT",
          pageNumber: null,
          strength: "STRONG",
          ...featureOpts,
        })
      );
    }
    for (const labeled of extractLabeledProjectLines(text, HEADER_PATTERNS)) {
      hits.push(
        ...matchPeersInText({
          text: labeled,
          peers: input.peers,
          attachmentId: att.attachmentId,
          filename: att.filename,
          category: "ATTACHMENT_DOCUMENT_HEADER_PROJECT",
          pageNumber: null,
          strength: "STRONG",
          ...featureOpts,
        })
      );
    }

    // Page samples (title block may be after page 1).
    for (const page of att.pageTexts ?? []) {
      for (const labeled of extractLabeledProjectLines(
        page.text,
        TITLE_BLOCK_PATTERNS
      )) {
        hits.push(
          ...matchPeersInText({
            text: labeled,
            peers: input.peers,
            attachmentId: att.attachmentId,
            filename: att.filename,
            category: "ATTACHMENT_TITLE_BLOCK_PROJECT",
            pageNumber: page.pageNumber,
            strength: "STRONG",
            ...featureOpts,
          })
        );
      }
    }

    // Body references in extracted text (weaker).
    hits.push(
      ...matchPeersInText({
        text: text.slice(0, 20_000),
        peers: input.peers,
        attachmentId: att.attachmentId,
        filename: att.filename,
        category: "ATTACHMENT_BODY_PROJECT_REFERENCE",
        pageNumber: null,
        strength: "WEAK",
        ...featureOpts,
      })
    );
  }

  // Prefer explicit title/header/filename/metadata over weak body mentions.
  const positive = hits.filter(
    (h) =>
      h.category !== "ATTACHMENT_INCIDENTAL_REFERENCE" &&
      h.category !== "ATTACHMENT_NEGATED_REFERENCE"
  );
  const nonBody = positive.filter(
    (h) => h.category !== "ATTACHMENT_BODY_PROJECT_REFERENCE"
  );
  const rankedPositive = nonBody.length > 0 ? nonBody : positive;
  const strong = rankedPositive.filter((h) => h.strength === "STRONG");
  const preferred = strong.length > 0 ? strong : rankedPositive;

  const jobIds = [...new Set(preferred.map((h) => h.jobId))];
  const evidence: JobMatchEvidence[] = [];
  for (const h of preferred.slice(0, 8)) {
    pushEvidence(evidence, h.category, h.supportingExcerpt || h.matchedPhrase, h.strength === "STRONG" ? 0.92 : 0.72);
  }

  const extractionComplete = pending === 0;
  const diagBase: AttachmentIdentityDiagnostics = {
    marker: "ATTACHMENT",
    attachmentsPresent: true,
    attachmentsProcessed: processed,
    attachmentsPending: pending,
    attachmentsFailed: failed,
    attachmentsUnsupported: unsupported,
    attachmentsUnavailable: unavailable,
    hits: preferred.slice(0, 20),
    extractionComplete,
    extractionRevision: EXTRACTION_REVISION,
    aiInvoked: false,
    reason: "NO_ATTACHMENT_EVIDENCE",
  };

  if (!extractionComplete && jobIds.length === 0) {
    return {
      status: "NO_MATCH",
      selectedJobId: null,
      candidateJobIds: [],
      evidence: [],
      diagnostics: {
        ...diagBase,
        reason: "ATTACHMENT_EXTRACTION_UNAVAILABLE",
      },
      laterStrength: "ABSENT",
      markerVersion: JOB_ATTACHMENT_IDENTITY_MARKER_VERSION,
    };
  }

  if (jobIds.length === 0) {
    return {
      status: "NO_MATCH",
      selectedJobId: null,
      candidateJobIds: [],
      evidence: [],
      diagnostics: diagBase,
      laterStrength: "ABSENT",
      markerVersion: JOB_ATTACHMENT_IDENTITY_MARKER_VERSION,
    };
  }

  if (jobIds.length > 1) {
    const hasStrongConflict =
      new Set(strong.map((h) => h.jobId)).size > 1;
    return {
      status: hasStrongConflict ? "CONFLICT" : "AMBIGUOUS",
      selectedJobId: null,
      candidateJobIds: jobIds,
      evidence,
      diagnostics: {
        ...diagBase,
        hits: preferred.slice(0, 20),
        reason: hasStrongConflict
          ? "ATTACHMENT_IDENTITY_CONFLICT"
          : "ATTACHMENT_IDENTITY_AMBIGUOUS",
      },
      laterStrength: hasStrongConflict ? "STRONG" : "WEAK",
      markerVersion: JOB_ATTACHMENT_IDENTITY_MARKER_VERSION,
    };
  }

  const selectedJobId = jobIds[0]!;
  const best = preferred.find((h) => h.jobId === selectedJobId)!;
  return {
    status: "MATCH",
    selectedJobId,
    candidateJobIds: [selectedJobId],
    evidence,
    diagnostics: {
      ...diagBase,
      reason: "ATTACHMENT_IDENTITY_MATCH",
    },
    laterStrength: best.strength === "STRONG" ? "STRONG" : "WEAK",
    markerVersion: JOB_ATTACHMENT_IDENTITY_MARKER_VERSION,
  };
}

/** Validate optional AI attachment adjudication against candidates + excerpts. */
export function validateAttachmentIdentityAiDecision(input: {
  decision: {
    selectedJobId: string | null;
    decision: "MATCH" | "AMBIGUOUS" | "CONFLICT" | "NO_MATCH";
    evidenceSource?: string;
    evidenceType?: string;
    attachmentId?: string | null;
    pageNumber?: number | null;
    supportingExcerpt?: string | null;
    interpretation?: string;
    competingJobIds?: string[];
    explanation?: string;
  };
  candidateJobIds: readonly string[];
  extractedTexts: readonly string[];
}): { ok: true } | { ok: false; reason: string } {
  const d = input.decision;
  if (d.selectedJobId != null && !input.candidateJobIds.includes(d.selectedJobId)) {
    return { ok: false, reason: "JOB_NOT_IN_CANDIDATES" };
  }
  for (const id of d.competingJobIds ?? []) {
    if (!input.candidateJobIds.includes(id)) {
      return { ok: false, reason: "COMPETING_NOT_IN_CANDIDATES" };
    }
  }
  if (d.decision === "MATCH") {
    if (!d.selectedJobId) return { ok: false, reason: "MATCH_WITHOUT_JOB" };
    const excerpt = d.supportingExcerpt?.trim() ?? "";
    if (!excerpt) return { ok: false, reason: "MATCH_WITHOUT_EVIDENCE" };
    const hay = input.extractedTexts.join("\n").toLowerCase();
    if (!hay.includes(excerpt.toLowerCase().slice(0, 200))) {
      return { ok: false, reason: "EVIDENCE_NOT_IN_TEXT" };
    }
  }
  return { ok: true };
}

/** Re-export for phrase tests. */
export { phraseContained };
