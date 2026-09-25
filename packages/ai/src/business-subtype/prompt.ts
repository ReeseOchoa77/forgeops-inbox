/**
 * Production business subtype contract (BUSINESS emails only).
 * Subtype is primary purpose. Job identity matching is a separate stage.
 */

import {
  buildSubtypeEvidencePacket,
  SUBTYPE_CLASSIFIER_VERSION,
  type SubtypeEvidencePacketInput,
  type SubtypeJobContext,
  type SubtypeThreadSnippet,
} from "./evidence-packet.js";

export const BUSINESS_SUBTYPE_KEYS = [
  "BID_OPPORTUNITY",
  "BID_UPDATE",
  "ESTIMATE_QUOTE",
  "PURCHASE_ORDER_CONTRACT",
  "PROJECT_COORDINATION",
  "RFI_CLARIFICATION",
  "SUBMITTAL_SHOP_DRAWING",
  "CHANGE_ORDER_SCOPE",
  "FABRICATION_PRODUCTION",
  "MATERIAL_PURCHASING",
  "DELIVERY_LOGISTICS",
  "INVOICE_PAYMENT",
  "FIELD_INSTALLATION",
  "COMPLIANCE_LEGAL",
  "INTERNAL_ADMIN",
  "OTHER_BUSINESS",
] as const;

export type BusinessSubtypeKey = (typeof BUSINESS_SUBTYPE_KEYS)[number];

export interface BusinessSubtypeResult {
  businessType: BusinessSubtypeKey;
  businessTypeConfidence: number;
  /** Another plausible subtype. Null when the primary purpose is clear. */
  competingType: BusinessSubtypeKey | null;
  /** Short evidence markers. Not hidden model reasoning. */
  evidence: string[];
  classifierVersion: typeof SUBTYPE_CLASSIFIER_VERSION;
}

export interface BusinessSubtypeActiveType {
  key: string;
  label: string;
  group?: string | null;
  order?: number | null;
}

export interface BusinessSubtypeEmailInput {
  normalizedSubject: string;
  senderName?: string | null | undefined;
  senderEmail: string;
  senderDomain?: string | null | undefined;
  cleanBody: string;
  attachmentNames?: string[] | undefined;
  activeBusinessTypes: BusinessSubtypeActiveType[];
  summary?: string | undefined;
  threadSnippets?: SubtypeThreadSnippet[] | undefined;
  job?: SubtypeJobContext | null | undefined;
}

export const businessSubtypeSystemPrompt = `
You assign the PRIMARY BUSINESS PURPOSE of one inbound email at a structural-steel fabricator. The email is already BUSINESS. Choose exactly one subtype from the allowed enum. Never invent a key.

PRIMARY PURPOSE, not keywords. An attachment or the word "drawings" does not make the subtype DRAWINGS. Ask what the sender is trying to accomplish in the current message. Subject is strong evidence. A job title on a signature is not evidence. Sender role is a hint, not a verdict. Job name/number identifies the project and does not imply a subtype.

CONFIDENCE (0 to 1):
- 0.80–1.00 HIGH: one purpose is clear and a competing subtype is weak.
- 0.50–0.79 MEDIUM: a purpose is likely, but name it in competingType.
- below 0.50 LOW: the current message is too thin. Still pick the best purpose. Do not use a high number to hide ambiguity.

OTHER_BUSINESS is for business mail whose purpose matches none of the specific subtypes. It is not a bucket for "I am unsure between two real subtypes." When two subtypes compete, pick the primary purpose, set competingType, and keep confidence in the MEDIUM band.

TIE-BREAKS:
- Pricing a bid, even with drawings attached → ESTIMATE_QUOTE or BID_OPPORTUNITY / BID_UPDATE, not SUBMITTAL_SHOP_DRAWING.
- Asking for approval of shop drawings → SUBMITTAL_SHOP_DRAWING, not FABRICATION_PRODUCTION.
- Shop release to fabricate → FABRICATION_PRODUCTION, not SUBMITTAL_SHOP_DRAWING.
- Formal RFI number or plan/spec discrepancy → RFI_CLARIFICATION. A casual question inside another workflow stays with that workflow.
- Added/deducted work or CO pricing → CHANGE_ORDER_SCOPE, not ESTIMATE_QUOTE.
- Award, PO, subcontract, LOI → PURCHASE_ORDER_CONTRACT, not BID_OPPORTUNITY.
- Mill order, supplier quote, lead time to buy steel → MATERIAL_PURCHASING. Truck, freight, or site receiving → DELIVERY_LOGISTICS.
- A delivery date inside a shipping email → DELIVERY_LOGISTICS, not PROJECT_COORDINATION.
- Invoice, pay app, lien waiver, remittance → INVOICE_PAYMENT. Do not split payment status into another type.
- Site erection, field measure, damaged steel → FIELD_INSTALLATION.
- Insurance, OSHA, certified payroll → COMPLIANCE_LEGAL.
- Internal office/staffing with no project workflow → INTERNAL_ADMIN.
- Meetings, status, sequencing with no better subtype → PROJECT_COORDINATION.

DEFINITIONS:
- BID_OPPORTUNITY: first invitation to bid, RFQ, RFP, or prequalification. Not a later addendum.
- BID_UPDATE: addendum, revised bid set, bid-date change, or pre-award clarification.
- ESTIMATE_QUOTE: preparing, sending, or revising a price. Not a purchase order.
- PURCHASE_ORDER_CONTRACT: PO, subcontract, award, LOI, or executed agreement.
- PROJECT_COORDINATION: schedule, meeting, status, or sequencing that is not delivery, fabrication, field, or a formal workflow above.
- RFI_CLARIFICATION: an RFI or a design/spec conflict that needs a formal answer.
- SUBMITTAL_SHOP_DRAWING: submittal, shop drawing approval, revise-and-resubmit, or engineer review.
- CHANGE_ORDER_SCOPE: change order, scope add/deduct, backcharge, or cost-impacting field directive.
- FABRICATION_PRODUCTION: shop status, production schedule, drawing release to the shop, weld/quality issue.
- MATERIAL_PURCHASING: buying steel or material: supplier price, availability, mill certs, requisition.
- DELIVERY_LOGISTICS: shipment, truck, freight, loading, or site delivery.
- INVOICE_PAYMENT: billing, pay application, payment status, lien waiver, or remittance.
- FIELD_INSTALLATION: erection, field measure, site damage, punch, or on-site repair.
- COMPLIANCE_LEGAL: insurance, safety, OSHA, license, certified payroll, or legal notice.
- INTERNAL_ADMIN: internal staffing, payroll admin, IT, or office operations.
- OTHER_BUSINESS: business, and none of the above is the purpose.

evidence: 1 to 4 short markers citing subject, current message, attachment filename, or thread. No chain-of-thought.
competingType: another allowed key, or null.
Return only JSON with businessType, businessTypeConfidence, competingType, and evidence.
`.trim();

export const businessSubtypeJsonSchema = {
  type: "object",
  properties: {
    businessType: {
      type: "string",
      enum: [...BUSINESS_SUBTYPE_KEYS],
    },
    businessTypeConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    competingType: {
      anyOf: [
        { type: "string", enum: [...BUSINESS_SUBTYPE_KEYS] },
        { type: "null" },
      ],
    },
    evidence: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 4,
    },
  },
  required: ["businessType", "businessTypeConfidence", "competingType", "evidence"],
  additionalProperties: false,
} as const;

export function buildBusinessSubtypeUserPrompt(
  input: BusinessSubtypeEmailInput
): string {
  const packet = buildSubtypeEvidencePacket({
    subject: input.normalizedSubject,
    cleanBody: input.cleanBody,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
    senderDomain: input.senderDomain,
    attachmentNames: input.attachmentNames,
    threadSnippets: input.threadSnippets,
    job: input.job,
    summary: input.summary,
  } satisfies SubtypeEvidencePacketInput);

  return [
    `Classifier: ${SUBTYPE_CLASSIFIER_VERSION}`,
    `Subject: ${packet.subject}`,
    "",
    "Sender (hint only, not a subtype):",
    `${packet.sender.name} <${packet.sender.email}> ${packet.sender.domain}`,
    "",
    "Current message (quoted history and signature removed):",
    packet.currentMessage || "(empty)",
    "",
    "Attachment filenames:",
    packet.attachments.length > 0 ? packet.attachments.join(", ") : "None",
    "",
    "Recent thread (older context, not the current message):",
    packet.thread.length > 0
      ? packet.thread
          .map((row) => `- ${row.senderEmail} | ${row.subject} | ${row.snippet}`)
          .join("\n")
      : "None",
    "",
    "Job identity (does not imply a subtype):",
    packet.job
      ? `${packet.job.jobNumber} ${packet.job.name}`.trim()
      : "None",
    "",
    "Summary:",
    packet.summary || "None",
    "",
    "Preferred subtype keys when one fits:",
    JSON.stringify(input.activeBusinessTypes ?? []),
  ].join("\n");
}
