/**
 * Canonical business subtype keys + display labels.
 * ONE source of truth for Inbox, Tasks, badges, and filters.
 * Do not duplicate these maps in feature UIs.
 */

export const BUSINESS_SUBTYPE_KEYS = [
  /** Explicit user "no specialized type" — distinct from null/unclassified. */
  "GENERAL",
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
  /** Explicit General — USER_EXPLICIT custom; AI must not overwrite. */
  GENERAL: "General",
  /**
   * Email subtype label (canonical key remains BID_OPPORTUNITY).
   * Distinct from BidCandidate entity ("Bid Candidate") and from the Inbox
   * Active Bid membership filter (INBOX_BID_INVITES_SOURCE_FILTER_LABEL).
   */
  BID_OPPORTUNITY: "Bid Opportunity",
  BID_UPDATE: "Bid Update / Addendum",
  /** User-facing: Quote (canonical key remains ESTIMATE_QUOTE). */
  ESTIMATE_QUOTE: "Quote",
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

/**
 * Lightweight direction hint for Inbox subtype filter UX.
 * Direction (SENT/RECEIVED) remains independent of subtype.
 * BOTH = show in either direction filter context.
 */
export type BusinessSubtypeDirectionHint = "INCOMING" | "SENT" | "BOTH";

export const BUSINESS_SUBTYPE_DIRECTION_HINTS: Record<
  BusinessSubtypeKey,
  BusinessSubtypeDirectionHint
> = {
  GENERAL: "BOTH",
  BID_OPPORTUNITY: "INCOMING",
  BID_UPDATE: "BOTH",
  ESTIMATE_QUOTE: "SENT",
  PURCHASE_ORDER_CONTRACT: "BOTH",
  PROJECT_COORDINATION: "BOTH",
  RFI_CLARIFICATION: "BOTH",
  SUBMITTAL_SHOP_DRAWING: "BOTH",
  CHANGE_ORDER_SCOPE: "BOTH",
  FABRICATION_PRODUCTION: "BOTH",
  MATERIAL_PURCHASING: "BOTH",
  DELIVERY_LOGISTICS: "BOTH",
  FIELD_INSTALLATION: "BOTH",
  INVOICE_PAYMENT: "BOTH",
  COMPLIANCE_LEGAL: "BOTH",
  INTERNAL_ADMIN: "BOTH",
  OTHER_BUSINESS: "BOTH",
};

/**
 * Inbox source-filter label when `businessTypeKey=BID_OPPORTUNITY` is selected.
 * Server semantics are BidCandidateEmail linked to an OPEN|QUOTED BidCandidate
 * (same set as Active Bids list + Candidate Emails tab). Not folder provenance
 * and not BID_OPPORTUNITY subtype membership. Subtype badges still use
 * BUSINESS_SUBTYPE_LABELS ("Bid Opportunity").
 */
export const INBOX_BID_INVITES_SOURCE_FILTER_LABEL = "Active Bids";

/** Label for an Inbox Active Bid filter option (BID_OPPORTUNITY key → Active Bids). */
export function inboxBusinessTypeFilterOptionLabel(
  key: BusinessSubtypeKey
): string {
  if (key === "BID_OPPORTUNITY") return INBOX_BID_INVITES_SOURCE_FILTER_LABEL;
  return BUSINESS_SUBTYPE_LABELS[key];
}

/** Filter / dropdown options in stable display order. */
export const BUSINESS_SUBTYPE_FILTER_OPTIONS: Array<{
  key: BusinessSubtypeKey;
  label: string;
}> = BUSINESS_SUBTYPE_KEYS.map((key) => ({
  key,
  label: BUSINESS_SUBTYPE_LABELS[key],
}));

/** Inbox subtype options filtered by mail direction context. */
export function businessSubtypeFilterOptionsForDirection(
  direction: "incoming" | "sent" | "all"
): Array<{ key: BusinessSubtypeKey; label: string }> {
  return BUSINESS_SUBTYPE_FILTER_OPTIONS.filter(({ key }) => {
    const hint = BUSINESS_SUBTYPE_DIRECTION_HINTS[key];
    if (direction === "all") return true;
    if (hint === "BOTH") return true;
    if (direction === "sent") return hint === "SENT";
    return hint === "INCOMING";
  });
}

/**
 * ForgeOps compose Email Type options (outbound).
 * General first, then Sent-relevant subtypes from shared direction metadata.
 */
export function businessSubtypeComposeOptions(): Array<{
  key: BusinessSubtypeKey;
  label: string;
}> {
  const outbound = businessSubtypeFilterOptionsForDirection("sent").filter(
    (o) => o.key !== "GENERAL"
  );
  return [
    { key: "GENERAL", label: BUSINESS_SUBTYPE_LABELS.GENERAL },
    ...outbound,
  ];
}

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
