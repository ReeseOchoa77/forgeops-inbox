/**
 * Detailed Bid/Quote scope: concrete items/work from evidence — not trade labels alone.
 * Never invent typical steel packages from a generic "Structural Steel" mention.
 */

export type ScopeItemKind = "ITEM" | "WORK" | "EXCLUSION" | "QUALIFICATION";

export type ScopeItemSource =
  | "EMAIL_BODY"
  | "ATTACHMENT_FILENAME"
  | "PDF_TEXT"
  | "DETERMINISTIC"
  | "AI_EXTRACTED"
  | "USER_EDITED";

export type ScopeItem = {
  name: string;
  details?: string | null;
  kind: ScopeItemKind;
  source?: ScopeItemSource;
};

/**
 * Structured scope for BidCandidate.proposedScopeDetail / BidQuoteStaging.extractedScopeDetail.
 * proposedScope / extractedScope remain compact summary strings for tables.
 */
export type DetailedScope = {
  /** Broad trade/category when stated (e.g. Structural steel) — not sufficient alone. */
  tradeCategory: string | null;
  items: ScopeItem[];
  work: ScopeItem[];
  exclusions: ScopeItem[];
  qualifications: ScopeItem[];
  /** Compact preview for lists (item names). Never a workflow placeholder. */
  summary: string | null;
  /**
   * True only when meaningful ITEM evidence exists (what is being furnished/installed).
   * Work actions alone (furnish/install) or trade labels are NOT complete detailed scope.
   * Does NOT mean "deterministic extractor finished running".
   */
  detailedComplete: boolean;
  extractionMethod?: "DETERMINISTIC" | "AI_ENRICHED" | "USER_EDITED" | null;
};

/** Workflow / review placeholders — never meaningful business scope content. */
const SCOPE_REVIEW_PLACEHOLDERS = new Set(
  [
    "scope needs review",
    "needs review",
    "detailed scope unknown / needs review",
    "scope incomplete",
  ].map((s) => s.toLowerCase())
);

export function isScopeReviewPlaceholder(
  text: string | null | undefined
): boolean {
  if (!text?.trim()) return false;
  const t = text.trim().toLowerCase();
  if (SCOPE_REVIEW_PLACEHOLDERS.has(t)) return true;
  // e.g. "Structural steel · Needs Review"
  if (/\bneeds review\b/i.test(t) && !/\bitem/i.test(t)) return true;
  return false;
}

/** Meaningful concrete ITEM rows (not generic trade labels). */
export function hasMeaningfulScopeItems(
  detail: Pick<DetailedScope, "items"> | null | undefined
): boolean {
  if (!detail?.items?.length) return false;
  return detail.items.some(
    (i) => Boolean(i.name?.trim()) && !isGenericScopeLabel(i.name)
  );
}

/** Trade/category labels that must NOT count as detailed scope by themselves. */
export const GENERIC_SCOPE_LABELS = new Set(
  [
    "structural steel",
    "structural",
    "steel",
    "miscellaneous metals",
    "misc metals",
    "misc. metals",
    "metals",
    "fabrication",
    "construction",
    "steel package",
    "steel packages",
    "metal fabrication",
    "structural + miscellaneous metals",
  ].map((s) => s.toLowerCase())
);

const TRADE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bstructural\s+steel\b/i, label: "Structural steel" },
  { re: /\bmisc(?:ellaneous)?\.?\s+metals?\b/i, label: "Miscellaneous metals" },
  { re: /\bsteel\s+package\b/i, label: "Steel package" },
  { re: /\bstructural\b.*\bmisc/i, label: "Structural + miscellaneous metals" },
];

/** Concrete products/assemblies — only when the word appears in evidence. */
const ITEM_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /\bstructural\s+steel\s+fram(?:e|ing)\b/i, name: "Structural steel framing" },
  { re: /\bbeams?\b/i, name: "Beams" },
  { re: /\bcolumns?\b/i, name: "Columns" },
  { re: /\bjoists?\b/i, name: "Joists" },
  { re: /\b(?:metal\s+)?deck(?:ing)?\b/i, name: "Metal deck" },
  { re: /\bstair\s+stringers?\b/i, name: "Stair stringers" },
  { re: /\bsteel\s+stairs?\b/i, name: "Steel stairs" },
  { re: /\bstairs?\b/i, name: "Stairs" },
  { re: /\bhandrails?\b/i, name: "Handrails" },
  { re: /\bguardrails?\b/i, name: "Guardrails" },
  { re: /\brailings?\b/i, name: "Railings" },
  { re: /\bladders?\b/i, name: "Ladders" },
  { re: /\bembeds?\b/i, name: "Embeds" },
  { re: /\blintels?\b/i, name: "Lintels" },
  { re: /\bbollards?\b/i, name: "Bollards" },
  { re: /\bequipment\s+supports?\b/i, name: "Equipment supports" },
  { re: /\bplate\s+girders?\b/i, name: "Plate girders" },
  { re: /\btrusses?\b/i, name: "Trusses" },
  { re: /\bcanop(?:y|ies)\b/i, name: "Canopies" },
  { re: /\bgrat(?:e|ing)\b/i, name: "Grating" },
];

const WORK_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /\bfurnish(?:\s+and)?\s+install\b/i, name: "Furnish and install" },
  { re: /\bprovide\s+and\s+install\b/i, name: "Provide and install" },
  { re: /\bfurnish(?:ing)?\b|\bsuppl(?:y|ied)\b/i, name: "Furnish/supply" },
  { re: /\bfabricat(?:e|ion|ed)\b/i, name: "Fabrication" },
  { re: /\berection\b/i, name: "Erection" },
  { re: /\binstall(?:ation|ed)?\b/i, name: "Installation" },
  { re: /\bfield\s+weld(?:ing|s)?\b/i, name: "Field welding" },
  { re: /\bgalvaniz(?:e|ed|ing)\b/i, name: "Galvanizing" },
  { re: /\bpaint(?:ing|ed)?\b/i, name: "Painting" },
  { re: /\bprime(?:r|d|ing)?\b/i, name: "Priming" },
];

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

export function isGenericScopeLabel(label: string | null | undefined): boolean {
  if (!label?.trim()) return true;
  return GENERIC_SCOPE_LABELS.has(label.trim().toLowerCase());
}

export function emptyDetailedScope(
  partial?: Partial<DetailedScope>
): DetailedScope {
  return {
    tradeCategory: partial?.tradeCategory ?? null,
    items: partial?.items ?? [],
    work: partial?.work ?? [],
    exclusions: partial?.exclusions ?? [],
    qualifications: partial?.qualifications ?? [],
    summary: partial?.summary ?? null,
    detailedComplete: partial?.detailedComplete ?? false,
    extractionMethod: partial?.extractionMethod ?? null,
  };
}

function pushUnique(
  list: ScopeItem[],
  item: ScopeItem,
  seen: Set<string>
): void {
  const key = `${item.kind}:${nameKey(item.name)}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    name: normalizeName(item.name),
    details: item.details ?? null,
    kind: item.kind,
    ...(item.source ? { source: item.source } : {}),
  });
}

function detectSource(
  bodyHit: boolean,
  pdfHit: boolean,
  filenameHit: boolean
): ScopeItemSource {
  if (bodyHit) return "EMAIL_BODY";
  if (pdfHit) return "PDF_TEXT";
  if (filenameHit) return "ATTACHMENT_FILENAME";
  return "DETERMINISTIC";
}

/**
 * Extract inclusions/exclusions from explicit phrasing only.
 */
function extractInclusionExclusionBlocks(
  text: string,
  source: ScopeItemSource,
  seen: Set<string>
): { exclusions: ScopeItem[]; qualifications: ScopeItem[]; workHints: ScopeItem[] } {
  const exclusions: ScopeItem[] = [];
  const qualifications: ScopeItem[] = [];
  const workHints: ScopeItem[] = [];

  // "Painting by others" / "erection by others"
  const byOthers = [
    ...text.matchAll(
      /\b([A-Za-z][A-Za-z\s/-]{2,40}?)\s+by\s+others\b/gi
    ),
  ];
  for (const m of byOthers) {
    const raw = (m[1] ?? "").trim();
    if (!raw || /^(provided|furnished|supplied|installed)$/i.test(raw)) continue;
    pushUnique(
      exclusions,
      { name: normalizeName(raw), kind: "EXCLUSION", details: "By others", source },
      seen
    );
  }

  // "Excludes erection" / "excluding field painting"
  const excludeLine = [
    ...text.matchAll(
      /\b(?:excludes?|excluding|excluded)\s*[:\-]?\s*([^\n.;]+)/gi
    ),
  ];
  for (const m of excludeLine) {
    const chunk = (m[1] ?? "").trim();
    if (!chunk) continue;
    for (const part of chunk.split(/,|;|\/|\band\b/i)) {
      const name = part.trim();
      if (name.length < 2 || name.length > 80) continue;
      pushUnique(
        exclusions,
        { name: normalizeName(name), kind: "EXCLUSION", source },
        seen
      );
    }
  }

  // "Fabricate only — erection by others" already covered; also "fabrication only"
  if (/\bfabricat(?:e|ion)\s+only\b/i.test(text)) {
    pushUnique(
      workHints,
      { name: "Fabrication", kind: "WORK", source },
      seen
    );
  }

  // Simple qualification: "galvanized finish on exterior rails"
  const qual = text.match(
    /\b((?:hot[- ]?dip\s+)?galvanized(?:\s+finish)?[^\n.;]{0,60})/i
  );
  if (qual?.[1]) {
    pushUnique(
      qualifications,
      {
        name: "Galvanized finish",
        details: normalizeName(qual[1]).slice(0, 120),
        kind: "QUALIFICATION",
        source,
      },
      seen
    );
  }

  return { exclusions, qualifications, workHints };
}

/**
 * Compact summary for storage/display when items exist.
 * Returns null when incomplete — UI shows "Scope incomplete" / "Needs review"
 * as presentation, not persisted business content.
 */
export function formatScopeSummary(detail: DetailedScope): string | null {
  const meaningful = detail.items.filter(
    (i) => Boolean(i.name?.trim()) && !isGenericScopeLabel(i.name)
  );
  if (meaningful.length === 0) return null;
  const preview = meaningful
    .slice(0, 3)
    .map((i) => i.name)
    .join(", ");
  const more = meaningful.length > 3 ? ` +${meaningful.length - 3}` : "";
  return `${meaningful.length} item${meaningful.length === 1 ? "" : "s"}: ${preview}${more}`;
}

/**
 * Completeness rule:
 * detailedComplete ⇔ at least one non-generic ITEM is present.
 * Work-only / trade-only / placeholder summary ⇒ incomplete.
 */
export function finalizeDetailedScope(detail: DetailedScope): DetailedScope {
  const detailedComplete = hasMeaningfulScopeItems(detail);
  const summary = formatScopeSummary({ ...detail, detailedComplete });
  // Never persist review placeholders as summary content.
  const cleanSummary =
    summary && !isScopeReviewPlaceholder(summary) ? summary : null;
  return {
    ...detail,
    detailedComplete,
    summary: cleanSummary,
  };
}

export function isDetailedScopeComplete(
  detail: DetailedScope | null | undefined
): boolean {
  if (!detail) return false;
  return Boolean(detail.detailedComplete);
}

/**
 * Deterministic detailed scope from subject/body/filenames/PDF text.
 * Only emits items/work that literally appear in evidence.
 */
export function extractDetailedScopeDeterministic(input: {
  subject?: string | null;
  bodyText?: string | null;
  attachmentNames?: string[];
  pdfText?: string | null;
}): DetailedScope {
  const subject = input.subject ?? "";
  const body = input.bodyText ?? "";
  const pdf = input.pdfText ?? "";
  const filenames = (input.attachmentNames ?? []).join(" ");
  const bodyText = `${subject}\n${body}`;
  const all = `${bodyText}\n${pdf}\n${filenames}`;

  const seen = new Set<string>();
  const items: ScopeItem[] = [];
  const work: ScopeItem[] = [];
  let tradeCategory: string | null = null;

  for (const p of TRADE_PATTERNS) {
    if (p.re.test(all)) {
      tradeCategory = p.label;
      break;
    }
  }

  for (const p of ITEM_PATTERNS) {
    const bodyHit = p.re.test(bodyText);
    const pdfHit = Boolean(pdf) && p.re.test(pdf);
    const fileHit = Boolean(filenames) && p.re.test(filenames);
    if (!bodyHit && !pdfHit && !fileHit) continue;
    // Avoid counting bare "stairs" twice when "steel stairs" already matched
    if (
      p.name === "Stairs" &&
      items.some((i) => /stair/i.test(i.name))
    ) {
      continue;
    }
    if (
      p.name === "Railings" &&
      items.some((i) => /rail/i.test(i.name))
    ) {
      continue;
    }
    pushUnique(
      items,
      {
        name: p.name,
        kind: "ITEM",
        source: detectSource(bodyHit, pdfHit, fileHit),
      },
      seen
    );
  }

  for (const p of WORK_PATTERNS) {
    const bodyHit = p.re.test(bodyText);
    const pdfHit = Boolean(pdf) && p.re.test(pdf);
    const fileHit = Boolean(filenames) && p.re.test(filenames);
    if (!bodyHit && !pdfHit && !fileHit) continue;
    // Painting as work only when not clearly "by others" in same phrase
    if (
      p.name === "Painting" &&
      /\bpaint(?:ing|ed)?\s+by\s+others\b/i.test(all)
    ) {
      continue;
    }
    if (
      p.name === "Erection" &&
      /\berection\s+by\s+others\b/i.test(all)
    ) {
      continue;
    }
    // Prefer compound "Furnish and install" over separate furnish + install.
    if (
      (p.name === "Furnish/supply" || p.name === "Installation") &&
      work.some((w) => /furnish and install|provide and install/i.test(w.name))
    ) {
      continue;
    }
    pushUnique(
      work,
      {
        name: p.name,
        kind: "WORK",
        source: detectSource(bodyHit, pdfHit, fileHit),
      },
      seen
    );
  }

  const bodyBlocks = extractInclusionExclusionBlocks(
    bodyText,
    "EMAIL_BODY",
    seen
  );
  const pdfBlocks = pdf
    ? extractInclusionExclusionBlocks(pdf, "PDF_TEXT", seen)
    : { exclusions: [], qualifications: [], workHints: [] };

  for (const w of [...bodyBlocks.workHints, ...pdfBlocks.workHints]) {
    pushUnique(work, w, seen);
  }

  // "stairs and rails" compound without separate rail match
  if (/\bstairs?\s+and\s+rails?\b/i.test(all)) {
    pushUnique(
      items,
      {
        name: "Stairs",
        kind: "ITEM",
        source: /\bstairs?\s+and\s+rails?\b/i.test(bodyText)
          ? "EMAIL_BODY"
          : "PDF_TEXT",
      },
      seen
    );
    pushUnique(
      items,
      {
        name: "Railings",
        kind: "ITEM",
        source: /\bstairs?\s+and\s+rails?\b/i.test(bodyText)
          ? "EMAIL_BODY"
          : "PDF_TEXT",
      },
      seen
    );
  }

  return finalizeDetailedScope({
    tradeCategory,
    items,
    work,
    exclusions: [...bodyBlocks.exclusions, ...pdfBlocks.exclusions],
    qualifications: [
      ...bodyBlocks.qualifications,
      ...pdfBlocks.qualifications,
    ],
    summary: null,
    detailedComplete: false,
    extractionMethod: "DETERMINISTIC",
  });
}

/** Compact string for proposedScope / extractedScope columns. */
export function scopeSummaryString(detail: DetailedScope): string | null {
  if (!detail.detailedComplete) return null;
  if (detail.summary && !isScopeReviewPlaceholder(detail.summary)) {
    return detail.summary;
  }
  return formatScopeSummary(detail);
}

/**
 * Merge AI structured scope into deterministic base.
 * AI items are accepted only when non-generic; never invent from trade alone.
 */
export function mergeAiScopeDetail(
  base: DetailedScope,
  ai: {
    tradeCategory?: string | null;
    items?: Array<{ name?: string | null; details?: string | null }>;
    work?: Array<{ name?: string | null; details?: string | null }>;
    exclusions?: Array<{ name?: string | null; details?: string | null }>;
    qualifications?: Array<{ name?: string | null; details?: string | null }>;
  } | null
    | undefined
): DetailedScope {
  if (!ai) return base;
  const seen = new Set<string>();
  const items = [...base.items];
  const work = [...base.work];
  const exclusions = [...base.exclusions];
  const qualifications = [...base.qualifications];
  for (const i of items) seen.add(`ITEM:${nameKey(i.name)}`);
  for (const w of work) seen.add(`WORK:${nameKey(w.name)}`);
  for (const e of exclusions) seen.add(`EXCLUSION:${nameKey(e.name)}`);
  for (const q of qualifications) seen.add(`QUALIFICATION:${nameKey(q.name)}`);

  const add = (
    list: ScopeItem[],
    kind: ScopeItemKind,
    rows: Array<{ name?: string | null; details?: string | null }> | undefined
  ) => {
    for (const row of rows ?? []) {
      const name = row.name?.trim();
      if (!name || isGenericScopeLabel(name)) continue;
      pushUnique(
        list,
        {
          name,
          details: row.details?.trim() || null,
          kind,
          source: "AI_EXTRACTED",
        },
        seen
      );
    }
  };

  add(items, "ITEM", ai.items);
  add(work, "WORK", ai.work);
  add(exclusions, "EXCLUSION", ai.exclusions);
  add(qualifications, "QUALIFICATION", ai.qualifications);

  const tradeCategory =
    base.tradeCategory ??
    (typeof ai.tradeCategory === "string" && ai.tradeCategory.trim()
      ? ai.tradeCategory.trim()
      : null);

  return finalizeDetailedScope({
    tradeCategory,
    items,
    work,
    exclusions,
    qualifications,
    summary: null,
    detailedComplete: false,
    extractionMethod:
      items.some((i) => i.source === "AI_EXTRACTED") ||
      work.some((w) => w.source === "AI_EXTRACTED")
        ? "AI_ENRICHED"
        : base.extractionMethod ?? "DETERMINISTIC",
  });
}

/** Parse user-edited free text into structured scope (line/bullet oriented). */
export function scopeDetailFromUserText(text: string | null | undefined): DetailedScope {
  const raw = (text ?? "").trim();
  if (!raw) return emptyDetailedScope({ extractionMethod: "USER_EDITED" });

  const lines = raw
    .split(/\n|;/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);

  // If user pasted a generic single label, keep as trade only.
  if (lines.length === 1 && isGenericScopeLabel(lines[0])) {
    return finalizeDetailedScope({
      tradeCategory: lines[0]!,
      items: [],
      work: [],
      exclusions: [],
      qualifications: [],
      summary: null,
      detailedComplete: false,
      extractionMethod: "USER_EDITED",
    });
  }

  const seen = new Set<string>();
  const items: ScopeItem[] = [];
  for (const line of lines.slice(0, 40)) {
    if (/^exclud/i.test(line)) continue;
    pushUnique(
      items,
      { name: line.slice(0, 120), kind: "ITEM", source: "USER_EDITED" },
      seen
    );
  }

  return finalizeDetailedScope({
    tradeCategory: null,
    items,
    work: [],
    exclusions: [],
    qualifications: [],
    summary: null,
    detailedComplete: false,
    extractionMethod: "USER_EDITED",
  });
}

export function parseDetailedScope(raw: unknown): DetailedScope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const asItems = (v: unknown, kind: ScopeItemKind): ScopeItem[] => {
    if (!Array.isArray(v)) return [];
    const out: ScopeItem[] = [];
    for (const row of v) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.name !== "string" || !r.name.trim()) continue;
      out.push({
        name: r.name.trim(),
        details: typeof r.details === "string" ? r.details : null,
        kind:
          r.kind === "ITEM" ||
          r.kind === "WORK" ||
          r.kind === "EXCLUSION" ||
          r.kind === "QUALIFICATION"
            ? r.kind
            : kind,
        ...(typeof r.source === "string"
          ? { source: r.source as ScopeItemSource }
          : {}),
      });
    }
    return out;
  };
  return finalizeDetailedScope({
    tradeCategory:
      typeof o.tradeCategory === "string" ? o.tradeCategory : null,
    items: asItems(o.items, "ITEM"),
    work: asItems(o.work, "WORK"),
    exclusions: asItems(o.exclusions, "EXCLUSION"),
    qualifications: asItems(o.qualifications, "QUALIFICATION"),
    summary: typeof o.summary === "string" ? o.summary : null,
    detailedComplete: Boolean(o.detailedComplete),
    extractionMethod:
      o.extractionMethod === "DETERMINISTIC" ||
      o.extractionMethod === "AI_ENRICHED" ||
      o.extractionMethod === "USER_EDITED"
        ? o.extractionMethod
        : null,
  });
}

export function scopeItemCount(detail: DetailedScope | null | undefined): number {
  if (!detail) return 0;
  return (
    detail.items.length +
    detail.work.length +
    detail.exclusions.length +
    detail.qualifications.length
  );
}
