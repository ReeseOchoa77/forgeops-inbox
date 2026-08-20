/**
 * Bridge between EmailMessage.mailboxCategory (BUSINESS | PERSONAL | …)
 * and legacy Classification.businessCategory (BUSINESS | NON_BUSINESS).
 *
 * Inbox list tabs filter by mailboxCategory; keep businessCategory in sync
 * whenever classification is written.
 */

export function legacyBusinessCategoryFromMailbox(
  mailboxCategory: "BUSINESS" | "PERSONAL"
): "BUSINESS" | "NON_BUSINESS" {
  return mailboxCategory === "PERSONAL" ? "NON_BUSINESS" : "BUSINESS";
}

export function mailboxCategoryFromLegacyBusinessFilter(
  businessCategory: "BUSINESS" | "NON_BUSINESS"
): "BUSINESS" | "PERSONAL" {
  return businessCategory === "NON_BUSINESS" ? "PERSONAL" : "BUSINESS";
}
