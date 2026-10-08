/**
 * Canonical business subtype keys + display labels.
 * ONE source of truth for Inbox, Tasks, badges, and filters.
 * Do not duplicate these maps in feature UIs.
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
  "FIELD_INSTALLATION",
  "INVOICE_PAYMENT",
  "COMPLIANCE_LEGAL",
  "INTERNAL_ADMIN",
  "OTHER_BUSINESS",
] as const;

export type BusinessSubtypeKey = (typeof BUSINESS_SUBTYPE_KEYS)[number];

export const BUSINESS_SUBTYPE_LABELS: Record<BusinessSubtypeKey, string> = {
  BID_OPPORTUNITY: "Bid Opportunity",
  BID_UPDATE: "Bid Update / Addendum",
  ESTIMATE_QUOTE: "Estimate / Quote",
  PURCHASE_ORDER_CONTRACT: "Purchase Order / Contract",
  PROJECT_COORDINATION: "Project Coordination",
  RFI_CLARIFICATION: "RFI / Clarification",
  SUBMITTAL_SHOP_DRAWING: "Submittal / Shop Drawing",
  CHANGE_ORDER_SCOPE: "Change Order / Scope Change",
  FABRICATION_PRODUCTION: "Fabrication / Production",
  MATERIAL_PURCHASING: "Material / Vendor / Purchasing",
  DELIVERY_LOGISTICS: "Delivery / Logistics",
  FIELD_INSTALLATION: "Field Issue / Installation",
  INVOICE_PAYMENT: "Invoice / Payment",
  COMPLIANCE_LEGAL: "Compliance / Safety / Legal",
  INTERNAL_ADMIN: "Internal Administration",
  OTHER_BUSINESS: "Other Business",
};

/** Filter / dropdown options in stable display order. */
export const BUSINESS_SUBTYPE_FILTER_OPTIONS: Array<{
  key: BusinessSubtypeKey;
  label: string;
}> = BUSINESS_SUBTYPE_KEYS.map((key) => ({
  key,
  label: BUSINESS_SUBTYPE_LABELS[key],
}));

export function businessSubtypeLabel(
  key: string | null | undefined
): string | null {
  if (!key) return null;
  if (key in BUSINESS_SUBTYPE_LABELS) {
    return BUSINESS_SUBTYPE_LABELS[key as BusinessSubtypeKey];
  }
  return null;
}

export function isBusinessSubtypeKey(
  key: string | null | undefined
): key is BusinessSubtypeKey {
  return (
    typeof key === "string" &&
    (BUSINESS_SUBTYPE_KEYS as readonly string[]).includes(key)
  );
}
