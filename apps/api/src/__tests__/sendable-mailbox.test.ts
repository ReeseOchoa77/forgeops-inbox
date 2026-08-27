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
  it("allows send for workspace MEMBER from any OAuth send-capable mailbox", () => {
    const result = assertUserMaySendAsConnection({
      workspaceRole: "MEMBER",
      connection: baseConn,
    });
    expect(result.ok).toBe(true);
    expect(
      isConnectionSendableForUser({
        workspaceRole: "ADMIN",
        connection: baseConn,
      })
    ).toBe(true);
  });

  it("allows ADMIN/OWNER to send as a monitored mailbox that is not their login email", () => {
    const result = assertUserMaySendAsConnection({
      workspaceRole: "ADMIN",
      connection: baseConn,
    });
    expect(result.ok).toBe(true);
  });

  it("403 when VIEWER tries to send", () => {
    const result = assertUserMaySendAsConnection({
      workspaceRole: "VIEWER",
      connection: baseConn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(403);
      expect(result.code).toBe("SEND_ROLE_DENIED");
    }
  });

  it("409 when Outlook lacks Mail.Send despite refresh token", () => {
    const result = assertUserMaySendAsConnection({
      workspaceRole: "OWNER",
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
      workspaceRole: "MEMBER",
      connection: { ...baseConn, status: "REQUIRES_REAUTH" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MAILBOX_REAUTH_REQUIRED");
    }
  });

  it("409 for tokenless / n8n-only mailbox", () => {
    const result = assertUserMaySendAsConnection({
      workspaceRole: "MEMBER",
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
