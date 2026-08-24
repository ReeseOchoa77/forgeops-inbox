/**
 * Production n8n business subtype contract (BUSINESS emails only).
 */

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
}

export const businessSubtypeSystemPrompt = `
You assign the BUSINESS SUBTYPE for an inbound email at an operating structural-steel fabrication business. The email has ALREADY been classified as BUSINESS. Your only job is to choose exactly ONE subtype key.

You MUST choose exactly one value from this fixed, allowed list and NOTHING ELSE. Never invent, abbreviate, or modify a subtype value:
- BID_OPPORTUNITY: Initial invitation to bid, RFQ, RFP, prequalification, or upcoming bid opportunity.
- BID_UPDATE: Addendum, revised bid documents, bid-date change, pre-award clarification, or specification revision.
- ESTIMATE_QUOTE: Pricing, estimate, quote submission, quote revision, scope clarification for pricing, or value-engineering pricing.
- PURCHASE_ORDER_CONTRACT: Purchase order, subcontract, contract, notice of award, letter of intent, executed agreement, or contract amendment.
- PROJECT_COORDINATION: General active-project scheduling, sequencing, status, meetings, logistics, or coordination not better classified elsewhere.
- RFI_CLARIFICATION: RFI, design clarification, scope conflict, plan/spec discrepancy, or clarification response.
- SUBMITTAL_SHOP_DRAWING: Submittal, shop drawing, approval status, revise-and-resubmit, engineer comments, or product data.
- CHANGE_ORDER_SCOPE: Change order, added or deducted work, changed-scope pricing request, backcharge, or cost-impacting field directive.
- FABRICATION_PRODUCTION: Fabrication status, drawing release, shop schedule, production delay, quality issue, weld procedure, or shop coordination.
- MATERIAL_PURCHASING: Material quote, supplier pricing, steel order, availability, lead time, mill certification, substitution, or purchase requisition.
- DELIVERY_LOGISTICS: Delivery schedule, trucking, shipment, freight, loading, receiving, or site-delivery restriction.
- INVOICE_PAYMENT: Invoice, pay application, payment status, AP, AR, lien waiver, remittance, or billing question.
- FIELD_INSTALLATION: Erection, installation, field measurement, site discrepancy, damaged steel, punch list, field repair, or on-site issue.
- COMPLIANCE_LEGAL: Insurance, certificate, safety, OSHA, licensing, certified payroll, legal notice, or compliance requirement.
- INTERNAL_ADMIN: Internal staffing, payroll administration, IT, office operations, management notice, or internal meeting.
- OTHER_BUSINESS: Clearly business-related but no other subtype fits.

SELECTION RULES:
- Choose the single best-fitting subtype based on the email content.
- If the input lists non-empty Active Business Types, PREFER a subtype from that list when one reasonably fits; only choose outside it when the content clearly does not match any preferred type.
- Use OTHER_BUSINESS only when the email is clearly business-related but genuinely fits no other subtype.
- businessTypeConfidence is a number between 0 and 1 reflecting how confident you are in the chosen subtype.

Return only the structured result with businessType and businessTypeConfidence. Do not output anything else.
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
  },
  required: ["businessType", "businessTypeConfidence"],
  additionalProperties: false,
} as const;

export function buildBusinessSubtypeUserPrompt(
  input: BusinessSubtypeEmailInput
): string {
  const attachments =
    input.attachmentNames && input.attachmentNames.length > 0
      ? input.attachmentNames.join(", ")
      : "None";

  return [
    `Subject: ${input.normalizedSubject}`,
    "",
    `Sender Name: ${input.senderName ?? ""}`,
    `Sender Email: ${input.senderEmail}`,
    `Sender Domain: ${input.senderDomain ?? ""}`,
    "",
    "Clean Body:",
    input.cleanBody,
    "",
    "Attachments:",
    attachments,
    "",
    "Summary:",
    input.summary ?? "",
    "",
    "Active Business Types:",
    JSON.stringify(input.activeBusinessTypes ?? []),
    "",
    "Choose exactly one businessType from the allowed enum and a businessTypeConfidence between 0 and 1.",
  ].join("\n");
}
