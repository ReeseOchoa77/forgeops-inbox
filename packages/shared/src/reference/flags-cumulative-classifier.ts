/**
 * Exact n8n flags + cumulative BUSINESS/PERSONAL decision algorithm.
 * Port of the production n8n classifier (Aug 2026). Pure / deterministic — no I/O.
 */

import type {
  ClassificationDecisionPayload,
  ClassificationDecisionRule,
  ClassificationEvidenceRecord,
} from "./classification-evidence-display.js";

export const STRONG_BUSINESS_FLAG_THRESHOLD = 0.8;
export const CUMULATIVE_BUSINESS_THRESHOLD = 150;

export type SenderEvidenceStatus =
  | "CONFIRMED_BUSINESS"
  | "CONFIRMED_PERSONAL"
  | "LIKELY_BUSINESS"
  | "LIKELY_PERSONAL"
  | "UNKNOWN"
  | "OBSERVED"
  | "BLOCKED"
  | string;

export interface FlagsCumulativeClassifierInput {
  contentBusinessProbability: number;
  subjectBusinessProbability: number;
  jobReferenceConfidence: number;
  /** Still accepted for evidence payload; excluded from the decision. */
  signatureCompanyMatchConfidence?: number | null | undefined;
  senderStatus?: SenderEvidenceStatus | null | undefined;
  senderConfidence?: number | null | undefined;
  contentExplanation?: string | null | undefined;
  subjectExplanation?: string | null | undefined;
  jobExplanation?: string | null | undefined;
  signatureExplanation?: string | null | undefined;
}

export interface FlagsCumulativeClassifierResult {
  mailboxCategory: "BUSINESS" | "PERSONAL";
  decisionRule: ClassificationDecisionRule;
  requiresReview: boolean;
  classificationDecision: ClassificationDecisionPayload;
  classificationEvidence: ClassificationEvidenceRecord;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toPoints(probability: number): number {
  return Math.round(clamp01(probability) * 100);
}

export function senderCumulativeAdjustment(
  status: SenderEvidenceStatus | null | undefined
): number {
  switch (status) {
    case "LIKELY_BUSINESS":
      return 25;
    case "LIKELY_PERSONAL":
      return -25;
    case "BLOCKED":
      return -25;
    case "CONFIRMED_BUSINESS":
    case "CONFIRMED_PERSONAL":
    case "UNKNOWN":
    case "OBSERVED":
    case null:
    case undefined:
      return 0;
    default:
      return 0;
  }
}

function isStrong(probability: number): boolean {
  return clamp01(probability) >= STRONG_BUSINESS_FLAG_THRESHOLD;
}

/**
 * Deterministic BUSINESS/PERSONAL decision (n8n flags + cumulative model).
 */
export function decideMailboxCategoryFlagsCumulative(
  input: FlagsCumulativeClassifierInput
): FlagsCumulativeClassifierResult {
  const content = clamp01(input.contentBusinessProbability);
  const subject = clamp01(input.subjectBusinessProbability);
  const job = clamp01(input.jobReferenceConfidence);
  const signature = clamp01(input.signatureCompanyMatchConfidence ?? 0);

  const contentBusiness = isStrong(content);
  const subjectBusiness = isStrong(subject);
  const jobBusiness = isStrong(job);
  const allThreeBusiness = contentBusiness && subjectBusiness && jobBusiness;

  const contentPoints = toPoints(content);
  const subjectPoints = toPoints(subject);
  const jobPoints = toPoints(job);
  const senderStatus = input.senderStatus ?? "UNKNOWN";
  const senderAdjustment = senderCumulativeAdjustment(senderStatus);
  const semanticTotal = contentPoints + subjectPoints + jobPoints;
  const cumulativeTotal = semanticTotal + senderAdjustment;

  const confirmedBusinessSender = senderStatus === "CONFIRMED_BUSINESS";
  const confirmedPersonalSender = senderStatus === "CONFIRMED_PERSONAL";

  let mailboxCategory: "BUSINESS" | "PERSONAL";
  let decisionRule: ClassificationDecisionRule;
  let requiresReview = false;

  if (confirmedBusinessSender) {
    mailboxCategory = "BUSINESS";
    decisionRule = "CONFIRMED_BUSINESS_SENDER";
  } else if (confirmedPersonalSender && allThreeBusiness) {
    mailboxCategory = "BUSINESS";
    decisionRule = "ALL_THREE_BUSINESS_FLAGS_OVERRIDE_CONFIRMED_PERSONAL";
    requiresReview = true;
  } else if (confirmedPersonalSender) {
    mailboxCategory = "PERSONAL";
    decisionRule = "CONFIRMED_PERSONAL_SENDER";
  } else if (contentBusiness || subjectBusiness || jobBusiness) {
    mailboxCategory = "BUSINESS";
    decisionRule = "STRONG_BUSINESS_FLAG";
  } else if (cumulativeTotal >= CUMULATIVE_BUSINESS_THRESHOLD) {
    mailboxCategory = "BUSINESS";
    decisionRule = "CUMULATIVE_BUSINESS_THRESHOLD";
  } else {
    mailboxCategory = "PERSONAL";
    decisionRule = "CUMULATIVE_PERSONAL";
  }

  const cumulativeBusiness = cumulativeTotal >= CUMULATIVE_BUSINESS_THRESHOLD;

  const classificationDecision: ClassificationDecisionPayload = {
    rule: decisionRule,
    flags: {
      confirmedBusinessSender,
      confirmedPersonalSender,
      contentBusiness,
      subjectBusiness,
      jobBusiness,
      allThreeBusiness,
      cumulativeBusiness,
    },
    cumulative: {
      contentPoints,
      subjectPoints,
      jobPoints,
      senderAdjustment,
      semanticTotal,
      total: cumulativeTotal,
      threshold: CUMULATIVE_BUSINESS_THRESHOLD,
    },
  };

  const classificationEvidence: ClassificationEvidenceRecord = {
    content: {
      probability: content,
      strongFlag: contentBusiness,
      explanation:
        input.contentExplanation ??
        `AI content analysis: ${Math.round(content * 100)}% business`,
    },
    subject: {
      probability: subject,
      strongFlag: subjectBusiness,
      explanation:
        input.subjectExplanation ??
        `Subject analysis: ${Math.round(subject * 100)}% business`,
    },
    job: {
      probability: job,
      strongFlag: jobBusiness,
      explanation:
        input.jobExplanation ??
        (job > 0
          ? `Job reference confidence: ${Math.round(job * 100)}%`
          : "No job reference detected"),
    },
    sender: {
      status: senderStatus,
      confidence: input.senderConfidence ?? null,
      cumulativeAdjustment: senderAdjustment,
    },
    signature: {
      probability: signature,
      includedInDecision: false,
      explanation:
        input.signatureExplanation ??
        (signature > 0
          ? `Company/signature match: ${Math.round(signature * 100)}% (excluded from decision)`
          : "Signature excluded from classification decision"),
    },
    decisionRule,
    cumulativeBusinessScore: cumulativeTotal,
    cumulativeBusinessThreshold: CUMULATIVE_BUSINESS_THRESHOLD,
    classificationDecision,
  };

  return {
    mailboxCategory,
    decisionRule,
    requiresReview,
    classificationDecision,
    classificationEvidence,
  };
}
