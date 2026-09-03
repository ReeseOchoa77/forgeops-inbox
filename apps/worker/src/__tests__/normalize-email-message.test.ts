import { describe, expect, it, vi } from "vitest";

import {
  normalizeEmailMessage,
  parseStoredAddressesTolerant,
} from "../application/services/normalize-email-message.js";

describe("parseStoredAddressesTolerant", () => {
  it("drops invalid emails that previously produced Zod path [0, email]", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = parseStoredAddressesTolerant(
      [
        { name: "Nextdoor", email: "undisclosed-recipients:" },
        { name: "Valid", email: "pm@example.com" },
        { name: null, email: "not-an-email" },
        { name: "Substack", email: " " },
      ],
      { field: "to", emailMessageId: "msg-1" }
    );
    expect(result).toEqual([{ name: "Valid", email: "pm@example.com" }]);
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it("strips Name <email> wrappers via safeOptionalEmail", () => {
    const result = parseStoredAddressesTolerant([
      { name: "Sam", email: "Sam Kanne <sam@forgeops.test>" },
    ]);
    expect(result).toEqual([{ name: "Sam", email: "sam@forgeops.test" }]);
  });

  it("coerces empty name to null", () => {
    const result = parseStoredAddressesTolerant([
      { name: "", email: "a@b.co" },
    ]);
    expect(result[0]?.name).toBeNull();
    expect(result[0]?.email).toBe("a@b.co");
  });
});

describe("normalizeEmailMessage recipient tolerance", () => {
  it("does not throw when newsletter-style recipients are invalid", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const normalized = normalizeEmailMessage({
      subject: "Weekly digest",
      threadSubject: null,
      snippet: null,
      bodyText: "Hello from Substack",
      receivedAt: new Date("2026-09-01T12:00:00.000Z"),
      senderName: "Substack",
      senderEmail: "noreply@substack.com",
      toAddresses: [
        { name: null, email: "undisclosed-recipients:" },
        { name: "Me", email: "user@company.com" },
      ],
      ccAddresses: [{ name: "Nextdoor", email: "mailer-daemon@" }],
      bccAddresses: null,
      replyToAddresses: [],
      labelIds: ["INBOX"],
      emailMessageId: "msg-newsletter",
    });

    expect(normalized.sender.email).toBe("noreply@substack.com");
    expect(normalized.recipients).toEqual([
      { name: "Me", email: "user@company.com", role: "TO" },
    ]);
    // Original senderEmail is not rewritten beyond trim/lower.
    expect(normalized.sender.email).toBe("noreply@substack.com");
    info.mockRestore();
  });

  it("still requires a valid canonical senderEmail", () => {
    expect(() =>
      normalizeEmailMessage({
        subject: "x",
        threadSubject: null,
        snippet: null,
        bodyText: "body",
        receivedAt: new Date(),
        senderName: null,
        senderEmail: "not-valid",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        replyToAddresses: [],
        labelIds: [],
      })
    ).toThrow(/senderEmail is not a valid email/);
  });
});
