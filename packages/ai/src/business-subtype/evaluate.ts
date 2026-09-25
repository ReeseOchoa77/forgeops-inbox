import type { BusinessSubtypeKey } from "./prompt.js";

/**
 * Sanitized subtype fixtures. These are not production emails and are not
 * model-accuracy claims. They define the expected primary purpose so a later
 * run against the live model can be scored.
 */
export interface SubtypeGoldenCase {
  id: string;
  subject: string;
  currentMessage: string;
  attachmentNames: string[];
  expected: BusinessSubtypeKey;
  competing: BusinessSubtypeKey | null;
  why: string;
  source: "curated_fixture";
}

export const SUBTYPE_GOLDEN_SET: SubtypeGoldenCase[] = [
  {
    id: "bid-invite",
    subject: "Invitation to bid — structural steel",
    currentMessage: "Please submit your bid for the structural steel package by Friday.",
    attachmentNames: ["Bid_Drawings.pdf"],
    expected: "BID_OPPORTUNITY",
    competing: "ESTIMATE_QUOTE",
    why: "The request is to enter a bid. Drawings are bid documents, not a submittal.",
    source: "curated_fixture",
  },
  {
    id: "bid-addendum",
    subject: "Addendum 2 — bid date moved",
    currentMessage: "Addendum 2 revises the bid date and specification section 05.",
    attachmentNames: ["Addendum_2.pdf"],
    expected: "BID_UPDATE",
    competing: "BID_OPPORTUNITY",
    why: "This changes an existing bid, it does not open one.",
    source: "curated_fixture",
  },
  {
    id: "pricing-with-drawings",
    subject: "Revised drawings for pricing",
    currentMessage: "Attached are revised drawings. Please update your price.",
    attachmentNames: ["Revised_IFC.pdf"],
    expected: "ESTIMATE_QUOTE",
    competing: "SUBMITTAL_SHOP_DRAWING",
    why: "The sender wants a price. Drawings are the basis of the quote.",
    source: "curated_fixture",
  },
  {
    id: "shop-approval",
    subject: "Submittal 05 12 00 — shop drawings",
    currentMessage: "Please review and approve the attached shop drawings.",
    attachmentNames: ["Submittal_051200.pdf"],
    expected: "SUBMITTAL_SHOP_DRAWING",
    competing: "FABRICATION_PRODUCTION",
    why: "The purpose is approval, not shop production status.",
    source: "curated_fixture",
  },
  {
    id: "rfi",
    subject: "RFI 027 — beam elevation conflict",
    currentMessage: "RFI 027: the plan elevation conflicts with the spec. Please clarify.",
    attachmentNames: ["RFI-027.pdf"],
    expected: "RFI_CLARIFICATION",
    competing: "PROJECT_COORDINATION",
    why: "A numbered RFI about a plan/spec conflict is a clarification workflow.",
    source: "curated_fixture",
  },
  {
    id: "change-order",
    subject: "Change Order #3",
    currentMessage: "CO #3 adds a stair landing. Please price the added scope.",
    attachmentNames: ["CO-003.pdf"],
    expected: "CHANGE_ORDER_SCOPE",
    competing: "ESTIMATE_QUOTE",
    why: "The price request is for changed scope, not a new bid.",
    source: "curated_fixture",
  },
  {
    id: "delivery",
    subject: "Steel delivery Thursday",
    currentMessage: "When can the truck arrive on site Thursday morning?",
    attachmentNames: [],
    expected: "DELIVERY_LOGISTICS",
    competing: "PROJECT_COORDINATION",
    why: "The question is about a shipment, not a general schedule meeting.",
    source: "curated_fixture",
  },
  {
    id: "invoice",
    subject: "Invoice 10382",
    currentMessage: "Attached is invoice 10382 for the March shipment. Payment is due in 30 days.",
    attachmentNames: ["Invoice-10382.pdf"],
    expected: "INVOICE_PAYMENT",
    competing: null,
    why: "The email transmits a bill.",
    source: "curated_fixture",
  },
  {
    id: "award",
    subject: "Notice of award",
    currentMessage: "You are awarded the structural package. The purchase order will follow.",
    attachmentNames: [],
    expected: "PURCHASE_ORDER_CONTRACT",
    competing: "BID_OPPORTUNITY",
    why: "The bid is over. This is an award.",
    source: "curated_fixture",
  },
  {
    id: "shop-release",
    subject: "Release to fabrication",
    currentMessage: "Drawings are released. Please start shop fabrication on sequence 2.",
    attachmentNames: [],
    expected: "FABRICATION_PRODUCTION",
    competing: "SUBMITTAL_SHOP_DRAWING",
    why: "The shop is being told to fabricate, not to submit for approval.",
    source: "curated_fixture",
  },
  {
    id: "thin-reply",
    subject: "Re: Submittal 05 12 00 — shop drawings",
    currentMessage: "Approved.",
    attachmentNames: [],
    expected: "SUBMITTAL_SHOP_DRAWING",
    competing: null,
    why: "The current body is only 'Approved.' The subject carries the workflow.",
    source: "curated_fixture",
  },
];

export interface SubtypePrediction {
  id: string;
  predicted: BusinessSubtypeKey;
  confidence: number;
}

export interface SubtypeEvaluationReport {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  perSubtype: Array<{
    subtype: BusinessSubtypeKey;
    support: number;
    predictedCount: number;
    correct: number;
    precision: number | null;
    recall: number | null;
  }>;
  confusion: Array<{ expected: BusinessSubtypeKey; predicted: BusinessSubtypeKey; count: number }>;
  lowConfidence: Array<{ id: string; predicted: BusinessSubtypeKey; confidence: number }>;
}

export function scoreSubtypeEvaluation(
  cases: Array<{ id: string; expected: BusinessSubtypeKey }>,
  predictions: SubtypePrediction[]
): SubtypeEvaluationReport {
  const byId = new Map(predictions.map((row) => [row.id, row]));
  const subtypes = new Set<BusinessSubtypeKey>();
  for (const row of cases) subtypes.add(row.expected);
  for (const row of predictions) subtypes.add(row.predicted);

  let correct = 0;
  const confusionMap = new Map<string, { expected: BusinessSubtypeKey; predicted: BusinessSubtypeKey; count: number }>();
  const support = new Map<BusinessSubtypeKey, number>();
  const predictedCount = new Map<BusinessSubtypeKey, number>();
  const truePositive = new Map<BusinessSubtypeKey, number>();
  const lowConfidence: SubtypeEvaluationReport["lowConfidence"] = [];

  for (const item of cases) {
    const prediction = byId.get(item.id);
    if (!prediction) continue;
    support.set(item.expected, (support.get(item.expected) ?? 0) + 1);
    predictedCount.set(prediction.predicted, (predictedCount.get(prediction.predicted) ?? 0) + 1);
    if (prediction.confidence < 0.5) {
      lowConfidence.push({
        id: item.id,
        predicted: prediction.predicted,
        confidence: prediction.confidence,
      });
    }
    if (prediction.predicted === item.expected) {
      correct += 1;
      truePositive.set(item.expected, (truePositive.get(item.expected) ?? 0) + 1);
    }
    const key = `${item.expected}->${prediction.predicted}`;
    const existing = confusionMap.get(key);
    if (existing) existing.count += 1;
    else confusionMap.set(key, { expected: item.expected, predicted: prediction.predicted, count: 1 });
  }

  const scored = cases.filter((item) => byId.has(item.id)).length;
  const perSubtype = [...subtypes].sort().map((subtype) => {
    const tp = truePositive.get(subtype) ?? 0;
    const pred = predictedCount.get(subtype) ?? 0;
    const sup = support.get(subtype) ?? 0;
    return {
      subtype,
      support: sup,
      predictedCount: pred,
      correct: tp,
      precision: pred === 0 ? null : tp / pred,
      recall: sup === 0 ? null : tp / sup,
    };
  });

  return {
    total: scored,
    correct,
    incorrect: scored - correct,
    accuracy: scored === 0 ? null : correct / scored,
    perSubtype,
    confusion: [...confusionMap.values()],
    lowConfidence,
  };
}
