import { describe, expect, it } from "vitest"
import {
  CLEAR_ALL_EMAILS_PHRASE,
  clearAllEmailsConfirmationMatches,
} from "./clear-inbox"

describe("clear all emails confirmation", () => {
  it("accepts the exact phrase", () => {
    expect(clearAllEmailsConfirmationMatches(CLEAR_ALL_EMAILS_PHRASE)).toBe(true)
    expect(clearAllEmailsConfirmationMatches("  Clear all emails  ")).toBe(true)
  })

  it("rejects a partial or different phrase", () => {
    expect(clearAllEmailsConfirmationMatches("clear all")).toBe(false)
    expect(clearAllEmailsConfirmationMatches("Clear Inbox")).toBe(false)
    expect(clearAllEmailsConfirmationMatches("")).toBe(false)
  })
})
