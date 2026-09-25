/**
 * Read-only subtype validation helpers.
 * Sampling and scoring never write Classification, jobs, or tasks.
 */

export const SUBTYPE_VALIDATION_TARGET_DEFAULT = 200;
export const SUBTYPE_VALIDATION_TARGET_MAX = 300;

export const SUBTYPE_ERROR_CATEGORIES = [
  "TAXONOMY_BOUNDARY",
  "CURRENT_BODY_PREPROCESSING",
  "MISSING_THREAD_CONTEXT",
  "MISLEADING_THREAD_CONTEXT",
  "SUBJECT_INTERPRETATION",
  "ATTACHMENT_FILENAME",
  "SENDER_HINT",
  "JOB_HINT",
  "MODEL_DECISION",
  "INSUFFICIENT_INFORMATION",
  "HUMAN_LABEL_AMBIGUOUS",
  "OTHER",
] as const;

export type SubtypeErrorCategory = (typeof SUBTYPE_ERROR_CATEGORIES)[number];

/** Pairs the audit treats as likely confusions. Both sides are oversampled. */
export const SUBTYPE_CONFUSION_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["BID_OPPORTUNITY", "BID_UPDATE"],
  ["BID_OPPORTUNITY", "ESTIMATE_QUOTE"],
  ["BID_UPDATE", "ESTIMATE_QUOTE"],
  ["SUBMITTAL_SHOP_DRAWING", "FABRICATION_PRODUCTION"],
  ["RFI_CLARIFICATION", "PROJECT_COORDINATION"],
  ["DELIVERY_LOGISTICS", "PROJECT_COORDINATION"],
  ["CHANGE_ORDER_SCOPE", "ESTIMATE_QUOTE"],
];

const CONFUSION_SUBTYPES = new Set(SUBTYPE_CONFUSION_PAIRS.flat());

export const SUBTYPE_VERIFY_PREFIX = "subtype-verify:";

/** Validation-only. Not a production subtype. */
export const SUBTYPE_AMBIGUITY_REASONS = [
  "MULTI_PURPOSE",
  "INSUFFICIENT_MESSAGE",
  "MISSING_THREAD",
  "TAXONOMY_GAP",
  "OTHER",
] as const;

export type SubtypeAmbiguityReason = (typeof SUBTYPE_AMBIGUITY_REASONS)[number];

export type SubtypeVerifyAction = "confirm" | "change" | "blind" | "ambiguous";

export type EvaluationLabelSource = "HISTORICAL_CORRECTION" | "BLIND_VALIDATION" | "ANCHORED_VALIDATION";

const VERIFY_ACTIONS = new Set<SubtypeVerifyAction>(["confirm", "change", "blind", "ambiguous"]);

export function isSubtypeAmbiguityReason(value: string): value is SubtypeAmbiguityReason {
  return (SUBTYPE_AMBIGUITY_REASONS as readonly string[]).includes(value);
}

export function encodeSubtypeVerifyReason(
  action: SubtypeVerifyAction,
  category?: SubtypeErrorCategory | SubtypeAmbiguityReason | null
): string {
  if (!category) return `${SUBTYPE_VERIFY_PREFIX}${action}`;
  return `${SUBTYPE_VERIFY_PREFIX}${action}|${category}`;
}

export function parseSubtypeVerifyReason(
  reason: string | null | undefined
): {
  action: SubtypeVerifyAction;
  category: SubtypeErrorCategory | SubtypeAmbiguityReason | null;
  source: "BLIND_VALIDATION" | "ANCHORED_VALIDATION";
} | null {
  if (!reason || !reason.startsWith(SUBTYPE_VERIFY_PREFIX)) return null;
  const rest = reason.slice(SUBTYPE_VERIFY_PREFIX.length);
  const [action, category] = rest.split("|");
  if (!VERIFY_ACTIONS.has(action as SubtypeVerifyAction)) return null;
  const parsedAction = action as SubtypeVerifyAction;
  let parsedCategory: SubtypeErrorCategory | SubtypeAmbiguityReason | null = null;
  if (category && (SUBTYPE_ERROR_CATEGORIES as readonly string[]).includes(category)) {
    parsedCategory = category as SubtypeErrorCategory;
  } else if (category && isSubtypeAmbiguityReason(category)) {
    parsedCategory = category;
  }
  return {
    action: parsedAction,
    category: parsedCategory,
    source: parsedAction === "blind" || parsedAction === "ambiguous"
      ? "BLIND_VALIDATION"
      : "ANCHORED_VALIDATION",
  };
}

/** Independent human label used as shadow-evaluation ground truth. Ambiguous labels are not a subtype. */
export function blindExpectedSubtype(
  reason: string | null | undefined,
  correctedBusinessType: string | null | undefined
): string | null {
  const parsed = parseSubtypeVerifyReason(reason);
  if (!parsed || parsed.action !== "blind") return null;
  if (!correctedBusinessType) return null;
  return correctedBusinessType;
}

export function evaluationLabelSource(input: {
  reason: string | null | undefined;
  originalBusinessType?: string | null;
  correctedBusinessType?: string | null;
}): EvaluationLabelSource | null {
  const parsed = parseSubtypeVerifyReason(input.reason);
  if (parsed) return parsed.source;
  if (
    input.correctedBusinessType &&
    input.originalBusinessType !== input.correctedBusinessType
  ) {
    return "HISTORICAL_CORRECTION";
  }
  return null;
}

/** Fields a reviewer may see before choosing a label. Stored subtype fields are absent. */
export const BLIND_REVIEW_EVIDENCE_FIELDS = [
  "subject",
  "currentMessage",
  "thread",
  "attachmentNames",
  "sender",
  "job",
] as const;

export function storedSubtypeVisible(phase: "before-label" | "after-label"): boolean {
  return phase === "after-label";
}

export function validationProgress(input: {
  labeled: number;
  ambiguous: number;
  target: number;
  remaining: number;
}): { reviewed: number; labeled: number; ambiguous: number; target: number; remaining: number } {
  return {
    reviewed: input.labeled + input.ambiguous,
    labeled: input.labeled,
    ambiguous: input.ambiguous,
    target: input.target,
    remaining: input.remaining,
  };
}

export type SubtypeConfidenceBandName = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export function subtypeStoredBand(confidence: number | null): SubtypeConfidenceBandName {
  if (confidence == null || !Number.isFinite(confidence)) return "UNKNOWN";
  if (confidence >= 0.8) return "HIGH";
  if (confidence >= 0.5) return "MEDIUM";
  return "LOW";
}

export interface SubtypeSampleCandidate {
  classificationId: string;
  subtype: string;
  confidence: number | null;
  competingType: string | null;
  bodyChars: number;
  hasAttachments: boolean;
  hasThreadContext: boolean;
  alreadyVerified: boolean;
}

export interface SubtypeSampleCoverage {
  subtypes: Array<{ subtype: string; count: number }>;
  bands: Record<SubtypeConfidenceBandName, number>;
  competingType: number;
  otherBusiness: number;
  shortReplies: number;
  longMessages: number;
  withAttachments: number;
  withoutAttachments: number;
  withThread: number;
  withoutThread: number;
}

export interface SubtypeSampleSelection {
  classificationIds: string[];
  target: number;
  available: number;
  coverage: SubtypeSampleCoverage;
}

const SHORT_BODY_CHARS = 120;
const LONG_BODY_CHARS = 1_500;

function isShort(row: SubtypeSampleCandidate): boolean {
  return row.bodyChars > 0 && row.bodyChars <= SHORT_BODY_CHARS;
}

function isLong(row: SubtypeSampleCandidate): boolean {
  return row.bodyChars >= LONG_BODY_CHARS;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = swap;
  }
  return copy;
}

function takeOne(
  rows: SubtypeSampleCandidate[] | undefined,
  selected: Set<string>,
  rng: () => number,
  band?: SubtypeConfidenceBandName
): SubtypeSampleCandidate | null {
  const open = (rows ?? []).filter((row) => !selected.has(row.classificationId));
  const preferred = band ? open.filter((row) => subtypeStoredBand(row.confidence) === band) : open;
  const pool = preferred.length > 0 ? preferred : open;
  if (pool.length === 0) return null;
  return shuffle(pool, rng)[0] ?? null;
}

function emptyBands(): Record<SubtypeConfidenceBandName, number> {
  return { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
}

function coverageFor(rows: SubtypeSampleCandidate[]): SubtypeSampleCoverage {
  const counts = new Map<string, number>();
  const bands = emptyBands();
  let competingType = 0;
  let otherBusiness = 0;
  let shortReplies = 0;
  let longMessages = 0;
  let withAttachments = 0;
  let withoutAttachments = 0;
  let withThread = 0;
  let withoutThread = 0;
  for (const row of rows) {
    counts.set(row.subtype, (counts.get(row.subtype) ?? 0) + 1);
    bands[subtypeStoredBand(row.confidence)] += 1;
    if (row.competingType) competingType += 1;
    if (row.subtype === "OTHER_BUSINESS") otherBusiness += 1;
    if (isShort(row)) shortReplies += 1;
    if (isLong(row)) longMessages += 1;
    if (row.hasAttachments) withAttachments += 1;
    else withoutAttachments += 1;
    if (row.hasThreadContext) withThread += 1;
    else withoutThread += 1;
  }
  return {
    subtypes: [...counts.entries()]
      .map(([subtype, count]) => ({ subtype, count }))
      .sort((a, b) => a.subtype.localeCompare(b.subtype)),
    bands,
    competingType,
    otherBusiness,
    shortReplies,
    longMessages,
    withAttachments,
    withoutAttachments,
    withThread,
    withoutThread,
  };
}

/**
 * Stratified sample. Verified rows are left out so review time goes to unlabeled mail.
 * Confusion-pair subtypes get extra picks after every present subtype has a turn.
 */
export function selectSubtypeValidationSample(
  candidates: SubtypeSampleCandidate[],
  options?: { target?: number; seed?: number }
): SubtypeSampleSelection {
  const requested = options?.target ?? SUBTYPE_VALIDATION_TARGET_DEFAULT;
  const target = Math.max(1, Math.min(SUBTYPE_VALIDATION_TARGET_MAX, Math.floor(requested)));
  const rng = mulberry32(options?.seed ?? 20260925);
  const pool = candidates.filter((row) => !row.alreadyVerified);
  const bySubtype = new Map<string, SubtypeSampleCandidate[]>();
  for (const row of pool) {
    const list = bySubtype.get(row.subtype) ?? [];
    list.push(row);
    bySubtype.set(row.subtype, list);
  }
  const subtypes = [...bySubtype.keys()].sort();
  const selected: SubtypeSampleCandidate[] = [];
  const selectedIds = new Set<string>();
  const bands: SubtypeConfidenceBandName[] = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];

  const pull = (subtype: string, band?: SubtypeConfidenceBandName) => {
    if (selected.length >= target) return;
    const choice = takeOne(bySubtype.get(subtype), selectedIds, rng, band);
    if (!choice) return;
    selected.push(choice);
    selectedIds.add(choice.classificationId);
  };

  for (let round = 0; round < bands.length && selected.length < target; round += 1) {
    for (const subtype of subtypes) pull(subtype, bands[round]);
  }

  for (let extra = 0; extra < 3 && selected.length < target; extra += 1) {
    for (const subtype of subtypes) {
      if (!CONFUSION_SUBTYPES.has(subtype)) continue;
      pull(subtype);
    }
  }

  const featureTargets: Array<(row: SubtypeSampleCandidate) => boolean> = [
    isShort,
    isLong,
    (row) => row.hasAttachments,
    (row) => !row.hasAttachments,
    (row) => row.hasThreadContext,
    (row) => !row.hasThreadContext,
    (row) => Boolean(row.competingType),
    (row) => row.subtype === "OTHER_BUSINESS",
  ];
  for (const feature of featureTargets) {
    let have = selected.filter(feature).length;
    const matches = shuffle(pool.filter(feature), rng);
    for (const row of matches) {
      if (have >= 12 || selected.length >= target) break;
      if (selectedIds.has(row.classificationId)) continue;
      selected.push(row);
      selectedIds.add(row.classificationId);
      have += 1;
    }
  }

  const remainder = shuffle(pool, rng);
  while (selected.length < target) {
    const next = remainder.find((row) => !selectedIds.has(row.classificationId));
    if (!next) break;
    selected.push(next);
    selectedIds.add(next.classificationId);
  }

  return {
    classificationIds: selected.map((row) => row.classificationId),
    target,
    available: pool.length,
    coverage: coverageFor(selected),
  };
}

export interface SubtypeShadowScoreInput {
  classificationId: string;
  expected: string;
  predicted: string;
  confidence: number;
  competingType: string | null;
  inputChars?: number | undefined;
  /** Human said the message was ambiguous. Excluded from accuracy. */
  ambiguous?: boolean | undefined;
}

export interface SubtypeShadowScore {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  perSubtype: Array<{
    subtype: string;
    sampleCount: number;
    predictedCount: number;
    correct: number;
    precision: number | null;
    recall: number | null;
  }>;
  bands: Array<{
    band: "HIGH" | "MEDIUM" | "LOW";
    sampleCount: number;
    correct: number;
    accuracy: number | null;
  }>;
  confusion: Array<{ expected: string; predicted: string; count: number }>;
  competing: {
    wrongPrimary: number;
    expectedWasCompeting: number;
    percentage: number | null;
  };
  otherBusiness: {
    predicted: number;
    expected: number;
    predictedAndCorrect: number;
    whenPredictedHumanExpected: Array<{ subtype: string; count: number }>;
  };
  input: {
    modelCalls: number;
    averageInputChars: number | null;
    totalInputChars: number;
  };
  reviewed: number;
  humanLabeled: number;
  humanAmbiguous: number;
}

function bandOfPrediction(confidence: number): "HIGH" | "MEDIUM" | "LOW" {
  if (confidence >= 0.8) return "HIGH";
  if (confidence >= 0.5) return "MEDIUM";
  return "LOW";
}

export function scoreSubtypeShadow(rows: SubtypeShadowScoreInput[]): SubtypeShadowScore {
  const humanAmbiguous = rows.filter((row) => row.ambiguous).length;
  const labeledRows = rows.filter((row) => !row.ambiguous);
  const subtypes = new Set<string>();
  for (const row of labeledRows) {
    subtypes.add(row.expected);
    subtypes.add(row.predicted);
  }
  const support = new Map<string, number>();
  const predictedCount = new Map<string, number>();
  const truePositive = new Map<string, number>();
  const confusion = new Map<string, { expected: string; predicted: string; count: number }>();
  const bandCounts = { HIGH: { n: 0, correct: 0 }, MEDIUM: { n: 0, correct: 0 }, LOW: { n: 0, correct: 0 } };
  let correct = 0;
  let wrongPrimary = 0;
  let expectedWasCompeting = 0;
  let otherPredicted = 0;
  let otherExpected = 0;
  let otherCorrect = 0;
  const otherHuman = new Map<string, number>();
  let totalInputChars = 0;
  let inputSamples = 0;

  for (const row of labeledRows) {
    support.set(row.expected, (support.get(row.expected) ?? 0) + 1);
    predictedCount.set(row.predicted, (predictedCount.get(row.predicted) ?? 0) + 1);
    const key = `${row.expected}->${row.predicted}`;
    const existing = confusion.get(key);
    if (existing) existing.count += 1;
    else confusion.set(key, { expected: row.expected, predicted: row.predicted, count: 1 });
    const band = bandOfPrediction(row.confidence);
    bandCounts[band].n += 1;
    const hit = row.predicted === row.expected;
    if (hit) {
      correct += 1;
      truePositive.set(row.expected, (truePositive.get(row.expected) ?? 0) + 1);
      bandCounts[band].correct += 1;
    } else {
      wrongPrimary += 1;
      if (row.competingType === row.expected) expectedWasCompeting += 1;
    }
    if (row.predicted === "OTHER_BUSINESS") {
      otherPredicted += 1;
      otherHuman.set(row.expected, (otherHuman.get(row.expected) ?? 0) + 1);
      if (hit) otherCorrect += 1;
    }
    if (row.expected === "OTHER_BUSINESS") otherExpected += 1;
    if (typeof row.inputChars === "number") {
      totalInputChars += row.inputChars;
      inputSamples += 1;
    }
  }

  const perSubtype = [...subtypes].sort().map((subtype) => {
    const tp = truePositive.get(subtype) ?? 0;
    const pred = predictedCount.get(subtype) ?? 0;
    const sup = support.get(subtype) ?? 0;
    return {
      subtype,
      sampleCount: sup,
      predictedCount: pred,
      correct: tp,
      precision: pred === 0 ? null : tp / pred,
      recall: sup === 0 ? null : tp / sup,
    };
  });

  return {
    total: labeledRows.length,
    correct,
    incorrect: labeledRows.length - correct,
    accuracy: labeledRows.length === 0 ? null : correct / labeledRows.length,
    perSubtype,
    bands: (["HIGH", "MEDIUM", "LOW"] as const).map((band) => ({
      band,
      sampleCount: bandCounts[band].n,
      correct: bandCounts[band].correct,
      accuracy: bandCounts[band].n === 0 ? null : bandCounts[band].correct / bandCounts[band].n,
    })),
    confusion: [...confusion.values()].sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected)),
    competing: {
      wrongPrimary,
      expectedWasCompeting,
      percentage: wrongPrimary === 0 ? null : expectedWasCompeting / wrongPrimary,
    },
    otherBusiness: {
      predicted: otherPredicted,
      expected: otherExpected,
      predictedAndCorrect: otherCorrect,
      whenPredictedHumanExpected: [...otherHuman.entries()]
        .map(([subtype, count]) => ({ subtype, count }))
        .sort((a, b) => b.count - a.count),
    },
    input: {
      modelCalls: labeledRows.length,
      averageInputChars: inputSamples === 0 ? null : totalInputChars / inputSamples,
      totalInputChars,
    },
    reviewed: rows.length,
    humanLabeled: labeledRows.length,
    humanAmbiguous,
  };
}
