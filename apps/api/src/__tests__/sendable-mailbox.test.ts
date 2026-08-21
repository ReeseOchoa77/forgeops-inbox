import { describe, expect, it } from "vitest";
import {
  assertUserMaySendAsConnection,
  connectionHasSendingScope,
  isConnectionSendableForUser,
} from "../application/services/sendable-mailbox.js";

const baseConn = {
  email: "ed@tekstl.net",
  provider: "OUTLOOK" as const,
  status: "ACTIVE" as const,
  hasRefreshToken: true,
  grantedScopes: [
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.Send",
    "offline_access",
  ],
};

describe("sendable-mailbox authorization", () => {
  it("allows send when user email matches connection and Mail.Send is granted", () => {
    const result = assertUserMaySendAsConnection({
      userEmail: "Ed@Tekstl.net",
      connection: baseConn,
    });
    expect(result.ok).toBe(true);
    expect(
      isConnectionSendableForUser({
        userEmail: "ed@tekstl.net",
        connection: baseConn,
      })
    ).toBe(true);
  });

  it("403 when ADMIN tries another user's mailbox", () => {
    const result = assertUserMaySendAsConnection({
      userEmail: "24rochoa@gmail.com",
      connection: baseConn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(403);
      expect(result.code).toBe("MAILBOX_IDENTITY_MISMATCH");
    }
  });

  it("409 when Outlook lacks Mail.Send despite refresh token", () => {
    const result = assertUserMaySendAsConnection({
      userEmail: "ed@tekstl.net",
      connection: {
        ...baseConn,
        grantedScopes: ["https://graph.microsoft.com/Mail.Read", "offline_access"],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(409);
      expect(result.code).toBe("SEND_SCOPE_MISSING");
    }
  });

  it("409 for REQUIRES_REAUTH", () => {
    const result = assertUserMaySendAsConnection({
      userEmail: "ed@tekstl.net",
      connection: { ...baseConn, status: "REQUIRES_REAUTH" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MAILBOX_REAUTH_REQUIRED");
    }
  });

  it("409 for tokenless / n8n-only mailbox", () => {
    const result = assertUserMaySendAsConnection({
      userEmail: "ed@tekstl.net",
      connection: { ...baseConn, hasRefreshToken: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MAILBOX_AUTH_REQUIRED");
    }
  });

  it("Gmail send scope detection", () => {
    expect(
      connectionHasSendingScope({
        provider: "GMAIL",
        grantedScopes: ["https://www.googleapis.com/auth/gmail.send"],
      })
    ).toBe(true);
    expect(
      connectionHasSendingScope({
        provider: "GMAIL",
        grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      })
    ).toBe(false);
  });

  it("accepts short Mail.Send form from Microsoft token responses", () => {
    expect(
      connectionHasSendingScope({
        provider: "OUTLOOK",
        grantedScopes: ["Mail.Send", "Mail.Read"],
      })
    ).toBe(true);
  });
});
