export type ClearInboxChoice = "NON_JOB_ONLY" | "HISTORICAL_IMPORT_ONLY" | "ALL_EMAILS"

export const CLEAR_ALL_EMAILS_PHRASE = "Clear all emails"

export function clearAllEmailsConfirmationMatches(value: string): boolean {
  return value.trim() === CLEAR_ALL_EMAILS_PHRASE
}
