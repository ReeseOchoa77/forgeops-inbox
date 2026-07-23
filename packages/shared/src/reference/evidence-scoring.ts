export interface EvidenceSignals {
  contentBusinessProbability: number;
  subjectBusinessProbability: number;
  signatureCompanyMatchConfidence: number;
  jobReferenceConfidence: number;
  senderStatus?: string | null;
  senderConfidence?: number;
  senderBusinessCount?: number;
  senderPersonalCount?: number;
}

export interface EvidenceWeights {
  content: number;
  sender: number;
  signature: number;
  job: number;
  subject: number;
}

export interface EvidenceThresholds {
  businessThreshold: number;
  personalThreshold: number;
}

export interface EvidenceComponent {
  probability: number;
  weight: number;
  contribution: number;
  explanation: string;
}

export interface ClassificationEvidence {
  content: EvidenceComponent;
  sender: EvidenceComponent;
  signature: EvidenceComponent;
  job: EvidenceComponent;
  subject: EvidenceComponent;
  finalBusinessProbability: number;
  classification: "BUSINESS" | "PERSONAL" | "REVIEW";
  requiresReview: boolean;
}

export const DEFAULT_WEIGHTS: EvidenceWeights = {
  content: 0.40,
  sender: 0.25,
  signature: 0.15,
  job: 0.15,
  subject: 0.05
};

export const DEFAULT_THRESHOLDS: EvidenceThresholds = {
  businessThreshold: 0.85,
  personalThreshold: 0.20
};

function computeSenderProbability(signals: EvidenceSignals): { probability: number; explanation: string } {
  const status = signals.senderStatus;

  if (status === "CONFIRMED_BUSINESS") {
    return { probability: 0.98, explanation: "Manually confirmed business sender" };
  }
  if (status === "CONFIRMED_PERSONAL") {
    return { probability: 0.05, explanation: "Manually confirmed personal sender" };
  }
  if (status === "LIKELY_BUSINESS") {
    return { probability: 0.85, explanation: "Repeated business sender (auto)" };
  }
  if (status === "BLOCKED") {
    return { probability: 0.02, explanation: "Blocked sender" };
  }

  const bizCount = signals.senderBusinessCount ?? 0;
  const persCount = signals.senderPersonalCount ?? 0;
  const total = bizCount + persCount;

  if (total === 0) {
    return { probability: 0.50, explanation: "First-time sender (no evidence)" };
  }

  const ratio = bizCount / total;
  return {
    probability: ratio,
    explanation: `${bizCount} business / ${persCount} personal observations`
  };
}

export function calculateBusinessProbability(
  signals: EvidenceSignals,
  weights: EvidenceWeights = DEFAULT_WEIGHTS,
  thresholds: EvidenceThresholds = DEFAULT_THRESHOLDS
): ClassificationEvidence {
  const sender = computeSenderProbability(signals);

  const content: EvidenceComponent = {
    probability: clamp(signals.contentBusinessProbability),
    weight: weights.content,
    contribution: clamp(signals.contentBusinessProbability) * weights.content,
    explanation: `AI content analysis: ${(signals.contentBusinessProbability * 100).toFixed(0)}% business`
  };

  const senderComp: EvidenceComponent = {
    probability: sender.probability,
    weight: weights.sender,
    contribution: sender.probability * weights.sender,
    explanation: sender.explanation
  };

  const signature: EvidenceComponent = {
    probability: clamp(signals.signatureCompanyMatchConfidence),
    weight: weights.signature,
    contribution: clamp(signals.signatureCompanyMatchConfidence) * weights.signature,
    explanation: signals.signatureCompanyMatchConfidence > 0
      ? `Company/contact match: ${(signals.signatureCompanyMatchConfidence * 100).toFixed(0)}%`
      : "No recognized company signature"
  };

  const job: EvidenceComponent = {
    probability: clamp(signals.jobReferenceConfidence),
    weight: weights.job,
    contribution: clamp(signals.jobReferenceConfidence) * weights.job,
    explanation: signals.jobReferenceConfidence > 0
      ? `Job reference found: ${(signals.jobReferenceConfidence * 100).toFixed(0)}%`
      : "No job reference detected"
  };

  const subject: EvidenceComponent = {
    probability: clamp(signals.subjectBusinessProbability),
    weight: weights.subject,
    contribution: clamp(signals.subjectBusinessProbability) * weights.subject,
    explanation: `Subject analysis: ${(signals.subjectBusinessProbability * 100).toFixed(0)}% business`
  };

  const finalBusinessProbability = content.contribution + senderComp.contribution + signature.contribution + job.contribution + subject.contribution;

  let classification: "BUSINESS" | "PERSONAL" | "REVIEW";
  let requiresReview: boolean;

  if (signals.senderStatus === "CONFIRMED_BUSINESS" && finalBusinessProbability > 0.5) {
    classification = "BUSINESS";
    requiresReview = false;
  } else if (signals.senderStatus === "CONFIRMED_PERSONAL" && finalBusinessProbability < 0.5) {
    classification = "PERSONAL";
    requiresReview = false;
  } else if (finalBusinessProbability >= thresholds.businessThreshold) {
    classification = "BUSINESS";
    requiresReview = false;
  } else if (finalBusinessProbability <= thresholds.personalThreshold) {
    classification = "PERSONAL";
    requiresReview = false;
  } else {
    classification = "REVIEW";
    requiresReview = true;
  }

  return {
    content,
    sender: senderComp,
    signature,
    job,
    subject,
    finalBusinessProbability,
    classification,
    requiresReview
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
