/**
 * Display helpers for n8n BUSINESS/PERSONAL classification evidence.
 * ForgeOps does not recompute the decision — only detect format and present it.
 */

import type { PriorityDecisionPayload } from "./priority-decision.js";

export type ClassificationDecisionRule =
  | "CONFIRMED_BUSINESS_SENDER"
  | "CONFIRMED_PERSONAL_SENDER"
  | "ALL_THREE_BUSINESS_FLAGS_OVERRIDE_CONFIRMED_PERSONAL"
  | "STRONG_BUSINESS_FLAG"
  | "CUMULATIVE_BUSINESS_THRESHOLD"
  | "CUMULATIVE_PERSONAL"
  | "PERSONAL_FALLBACK"
  | "CONFIRMED_JOB_ASSOCIATION"
  | string;

export interface ClassificationDecisionPayload {
  rule?: string;
  flags?: {
    confirmedBusinessSender?: boolean;
    confirmedPersonalSender?: boolean;
    contentBusiness?: boolean;
    subjectBusiness?: boolean;
    jobBusiness?: boolean;
    allThreeBusiness?: boolean;
    cumulativeBusiness?: boolean;
  };
  cumulative?: {
    contentPoints?: number;
    subjectPoints?: number;
    jobPoints?: number;
    senderAdjustment?: number;
    semanticTotal?: number;
    total?: number;
    threshold?: number;
  };
}

export interface NewSignalEvidence {
  probability?: number;
  strongFlag?: boolean;
  explanation?: string;
  status?: string;
  confidence?: number | null;
  cumulativeAdjustment?: number;
  includedInDecision?: boolean;
  weight?: number;
  contribution?: number;
}

export type ClassificationEvidenceRecord = Record<string, unknown> & {
  content?: NewSignalEvidence;
  sender?: NewSignalEvidence;
  signature?: NewSignalEvidence;
  job?: NewSignalEvidence;
  subject?: NewSignalEvidence;
  finalBusinessProbability?: number;
  decisionRule?: string;
  cumulativeBusinessScore?: number;
  cumulativeBusinessThreshold?: number;
  classificationDecision?: ClassificationDecisionPayload;
  /** Deterministic n8n priority explanation (optional; historical records omit). */
  priorityDecision?: PriorityDecisionPayload;
};

export type EvidenceFormat = "legacy_weighted" | "new_flags" | "unknown";

export function detectEvidenceFormat(evidence: unknown): EvidenceFormat {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return "unknown";
  }
  const e = evidence as ClassificationEvidenceRecord;

  if (
    typeof e.decisionRule === "string" ||
    e.classificationDecision != null ||
    typeof e.cumulativeBusinessScore === "number" ||
    (e.content != null &&
      typeof e.content === "object" &&
      "strongFlag" in (e.content as object))
  ) {
    return "new_flags";
  }

  if (
    typeof e.finalBusinessProbability === "number" ||
    (e.content != null &&
      typeof e.content === "object" &&
      typeof (e.content as NewSignalEvidence).weight === "number")
  ) {
    return "legacy_weighted";
  }

  return "unknown";
}

export function isLegacyWeightedEvidence(evidence: unknown): boolean {
  return detectEvidenceFormat(evidence) === "legacy_weighted";
}

export function isNewFlagEvidence(evidence: unknown): boolean {
  return detectEvidenceFormat(evidence) === "new_flags";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pct(probability: number | null | undefined): number | null {
  if (probability == null || !Number.isFinite(probability)) return null;
  return Math.round(probability * 100);
}

export interface EvidenceSignalRow {
  key: "content" | "subject" | "job" | "sender" | "signature";
  label: string;
  probabilityPct: number | null;
  strongFlag: boolean | null;
  points: number | null;
  explanation: string | null;
  includedInDecision: boolean;
  status: string | null;
  cumulativeAdjustment: number | null;
}

export interface ClassificationEvidenceViewModel {
  format: EvidenceFormat;
  decisionRule: string | null;
  decisionTitle: string;
  decisionSummary: string;
  categoryLabel: "BUSINESS" | "PERSONAL" | null;
  showCumulativeBreakdown: boolean;
  showStrongSignals: boolean;
  showOverrideBanner: boolean;
  showConfirmedSenderBanner: boolean;
  requiresReviewHint: boolean;
  signals: EvidenceSignalRow[];
  cumulative: {
    contentPoints: number | null;
    subjectPoints: number | null;
    jobPoints: number | null;
    senderAdjustment: number | null;
    total: number | null;
    threshold: number | null;
  } | null;
  /** Legacy-only: 0..1 final weighted probability */
  legacyFinalBusinessProbability: number | null;
  confidenceLabel:
    | "Classification confidence"
    | "Final Business Probability"
    | "Confidence";
}

const RULE_TITLES: Record<string, string> = {
  CONFIRMED_BUSINESS_SENDER: "Confirmed business sender",
  CONFIRMED_PERSONAL_SENDER: "Confirmed personal sender",
  ALL_THREE_BUSINESS_FLAGS_OVERRIDE_CONFIRMED_PERSONAL:
    "Confirmed personal sender overridden",
  STRONG_BUSINESS_FLAG: "Strong business flag",
  CUMULATIVE_BUSINESS_THRESHOLD: "Cumulative business evidence",
  CUMULATIVE_PERSONAL: "Cumulative evidence below threshold",
  PERSONAL_FALLBACK: "Cumulative evidence below threshold",
  CONFIRMED_JOB_ASSOCIATION: "Attached to confirmed ForgeOps job",
};

function ruleTitle(rule: string | null): string {
  if (!rule) return "Classification decision";
  return (
    RULE_TITLES[rule] ??
    rule
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

function ruleSummary(
  rule: string | null,
  category: "BUSINESS" | "PERSONAL" | null,
  signals: EvidenceSignalRow[]
): string {
  switch (rule) {
    case "CONFIRMED_BUSINESS_SENDER":
      return "Confirmed business sender → Business classification";
    case "CONFIRMED_JOB_ASSOCIATION":
      return "Attached to confirmed ForgeOps job → BUSINESS";
    case "CONFIRMED_PERSONAL_SENDER":
      return "Confirmed personal sender → Personal classification";
    case "ALL_THREE_BUSINESS_FLAGS_OVERRIDE_CONFIRMED_PERSONAL":
      return "All three business signals exceeded the 80% override threshold. Requires review.";
    case "STRONG_BUSINESS_FLAG": {
      const strong = signals
        .filter(
          (s) =>
            s.strongFlag &&
            (s.key === "content" || s.key === "subject" || s.key === "job")
        )
        .map((s) => s.label);
      if (strong.length === 0) {
        return "One or more signals exceeded the 80% business threshold.";
      }
      return `${strong.join(" and ")} exceeded the 80% business threshold.`;
    }
    case "CUMULATIVE_BUSINESS_THRESHOLD":
      return "Cumulative evidence score met or exceeded the decision threshold → Business";
    case "CUMULATIVE_PERSONAL":
    case "PERSONAL_FALLBACK":
      return "Cumulative evidence score was below the decision threshold → Personal";
    default:
      if (category === "BUSINESS") return "Classified as Business.";
      if (category === "PERSONAL") return "Classified as Personal.";
      return "Classification decision from n8n.";
  }
}

function buildSignalRows(
  evidence: ClassificationEvidenceRecord,
  decision: ClassificationDecisionPayload | null
): EvidenceSignalRow[] {
  const flags = decision?.flags;
  const cumulative = decision?.cumulative;

  const contentProb = asNumber(evidence.content?.probability);
  const subjectProb = asNumber(evidence.subject?.probability);
  const jobProb = asNumber(evidence.job?.probability);

  return [
    {
      key: "content",
      label: "Content",
      probabilityPct: pct(contentProb),
      strongFlag: evidence.content?.strongFlag ?? flags?.contentBusiness ?? null,
      points:
        asNumber(cumulative?.contentPoints) ??
        (contentProb != null ? Math.round(contentProb * 100) : null),
      explanation: evidence.content?.explanation ?? null,
      includedInDecision: evidence.content?.includedInDecision !== false,
      status: null,
      cumulativeAdjustment: null,
    },
    {
      key: "subject",
      label: "Subject",
      probabilityPct: pct(subjectProb),
      strongFlag:
        evidence.subject?.strongFlag ?? flags?.subjectBusiness ?? null,
      points:
        asNumber(cumulative?.subjectPoints) ??
        (subjectProb != null ? Math.round(subjectProb * 100) : null),
      explanation: evidence.subject?.explanation ?? null,
      includedInDecision: evidence.subject?.includedInDecision !== false,
      status: null,
      cumulativeAdjustment: null,
    },
    {
      key: "job",
      label: "Job",
      probabilityPct: pct(jobProb),
      strongFlag: evidence.job?.strongFlag ?? flags?.jobBusiness ?? null,
      points:
        asNumber(cumulative?.jobPoints) ??
        (jobProb != null ? Math.round(jobProb * 100) : null),
      explanation: evidence.job?.explanation ?? null,
      includedInDecision: evidence.job?.includedInDecision !== false,
      status: null,
      cumulativeAdjustment: null,
    },
    {
      key: "sender",
      label: "Sender",
      probabilityPct: pct(asNumber(evidence.sender?.probability)),
      strongFlag: null,
      points: null,
      explanation: evidence.sender?.explanation ?? null,
      includedInDecision: true,
      status:
        typeof evidence.sender?.status === "string"
          ? evidence.sender.status
          : null,
      cumulativeAdjustment:
        asNumber(evidence.sender?.cumulativeAdjustment) ??
        asNumber(cumulative?.senderAdjustment),
    },
    {
      key: "signature",
      label: "Signature",
      probabilityPct: pct(asNumber(evidence.signature?.probability)),
      strongFlag: null,
      points: null,
      explanation: evidence.signature?.explanation ?? null,
      includedInDecision: evidence.signature?.includedInDecision === true,
      status: null,
      cumulativeAdjustment: null,
    },
  ];
}

/**
 * Build a UI-ready view model from persisted classificationEvidence JSON.
 * Does not recompute classification — only presents n8n evidence.
 */
export function buildClassificationEvidenceViewModel(
  evidence: unknown,
  mailboxCategory?: string | null
): ClassificationEvidenceViewModel | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }

  const e = evidence as ClassificationEvidenceRecord;
  const format = detectEvidenceFormat(e);
  const category: "BUSINESS" | "PERSONAL" | null =
    mailboxCategory === "BUSINESS" || mailboxCategory === "PERSONAL"
      ? mailboxCategory
      : null;

  if (format === "legacy_weighted") {
    return {
      format,
      decisionRule: null,
      decisionTitle: "Weighted classification evidence",
      decisionSummary:
        "Legacy weighted model (content/sender/signature/job/subject).",
      categoryLabel: category,
      showCumulativeBreakdown: false,
      showStrongSignals: false,
      showOverrideBanner: false,
      showConfirmedSenderBanner: false,
      requiresReviewHint: false,
      signals: (
        ["content", "sender", "signature", "job", "subject"] as const
      ).map((key) => {
        const signal = e[key] as NewSignalEvidence | undefined;
        return {
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1),
          probabilityPct: pct(asNumber(signal?.probability)),
          strongFlag: null,
          points: null,
          explanation: signal?.explanation ?? null,
          includedInDecision: true,
          status: typeof signal?.status === "string" ? signal.status : null,
          cumulativeAdjustment: null,
        };
      }),
      cumulative: null,
      legacyFinalBusinessProbability: asNumber(e.finalBusinessProbability),
      confidenceLabel: "Final Business Probability",
    };
  }

  if (format !== "new_flags") {
    return {
      format: "unknown",
      decisionRule: null,
      decisionTitle: "Classification evidence",
      decisionSummary: "Evidence present but format not recognized.",
      categoryLabel: category,
      showCumulativeBreakdown: false,
      showStrongSignals: false,
      showOverrideBanner: false,
      showConfirmedSenderBanner: false,
      requiresReviewHint: false,
      signals: [],
      cumulative: null,
      legacyFinalBusinessProbability: null,
      confidenceLabel: "Confidence",
    };
  }

  const decision =
    e.classificationDecision && typeof e.classificationDecision === "object"
      ? e.classificationDecision
      : null;
  const rule =
    (typeof e.decisionRule === "string" ? e.decisionRule : null) ??
    (typeof decision?.rule === "string" ? decision.rule : null);

  const signals = buildSignalRows(e, decision);
  const threshold =
    asNumber(e.cumulativeBusinessThreshold) ??
    asNumber(decision?.cumulative?.threshold) ??
    150;
  const total =
    asNumber(e.cumulativeBusinessScore) ??
    asNumber(decision?.cumulative?.total) ??
    null;

  const showConfirmedSenderBanner =
    rule === "CONFIRMED_BUSINESS_SENDER" ||
    rule === "CONFIRMED_PERSONAL_SENDER" ||
    rule === "CONFIRMED_JOB_ASSOCIATION";
  const showOverrideBanner =
    rule === "ALL_THREE_BUSINESS_FLAGS_OVERRIDE_CONFIRMED_PERSONAL";
  const showCumulativeBreakdown =
    rule === "CUMULATIVE_BUSINESS_THRESHOLD" ||
    rule === "CUMULATIVE_PERSONAL" ||
    rule === "PERSONAL_FALLBACK" ||
    (!showConfirmedSenderBanner &&
      !showOverrideBanner &&
      rule !== "STRONG_BUSINESS_FLAG" &&
      total != null);
  const showStrongSignals =
    rule === "STRONG_BUSINESS_FLAG" || showOverrideBanner;

  return {
    format,
    decisionRule: rule,
    decisionTitle: ruleTitle(rule),
    decisionSummary: ruleSummary(rule, category, signals),
    categoryLabel: category,
    showCumulativeBreakdown,
    showStrongSignals,
    showOverrideBanner,
    showConfirmedSenderBanner,
    requiresReviewHint: showOverrideBanner,
    signals,
    cumulative: {
      contentPoints:
        asNumber(decision?.cumulative?.contentPoints) ??
        signals.find((s) => s.key === "content")?.points ??
        null,
      subjectPoints:
        asNumber(decision?.cumulative?.subjectPoints) ??
        signals.find((s) => s.key === "subject")?.points ??
        null,
      jobPoints:
        asNumber(decision?.cumulative?.jobPoints) ??
        signals.find((s) => s.key === "job")?.points ??
        null,
      senderAdjustment:
        asNumber(decision?.cumulative?.senderAdjustment) ??
        signals.find((s) => s.key === "sender")?.cumulativeAdjustment ??
        null,
      total,
      threshold,
    },
    legacyFinalBusinessProbability: null,
    confidenceLabel: "Classification confidence",
  };
}

/** Extract n8n free-text review reasons from Classification.routingHints JSON. */
export function extractN8nReviewReasons(routingHints: unknown): string[] {
  if (
    !routingHints ||
    typeof routingHints !== "object" ||
    Array.isArray(routingHints)
  ) {
    return [];
  }
  const hints = routingHints as { reviewReasons?: unknown };
  if (!Array.isArray(hints.reviewReasons)) return [];
  return hints.reviewReasons
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .map((r) => r.trim());
}

/**
 * Merge classificationDecision / priorityDecision into evidence JSON for single-field persistence.
 * Does not mutate inputs. Does not recompute BUSINESS/PERSONAL or priority.
 */
export function mergeClassificationEvidenceForPersist(input: {
  classificationEvidence: Record<string, unknown> | null | undefined;
  classificationDecision?:
    | ClassificationDecisionPayload
    | Record<string, unknown>
    | null
    | undefined;
  priorityDecision?: PriorityDecisionPayload | Record<string, unknown> | null | undefined;
}): Record<string, unknown> | null {
  const evidence = input.classificationEvidence
    ? { ...input.classificationEvidence }
    : {};
  if (input.classificationDecision) {
    const decision = input.classificationDecision as ClassificationDecisionPayload;
    evidence.classificationDecision = decision;
    if (typeof decision.rule === "string" && evidence.decisionRule == null) {
      evidence.decisionRule = decision.rule;
    }
    const cum = decision.cumulative;
    if (cum) {
      if (
        evidence.cumulativeBusinessScore == null &&
        typeof cum.total === "number"
      ) {
        evidence.cumulativeBusinessScore = cum.total;
      }
      if (
        evidence.cumulativeBusinessThreshold == null &&
        typeof cum.threshold === "number"
      ) {
        evidence.cumulativeBusinessThreshold = cum.threshold;
      }
    }
  }
  if (input.priorityDecision) {
    evidence.priorityDecision = input.priorityDecision;
  }
  return Object.keys(evidence).length > 0 ? evidence : null;
}
