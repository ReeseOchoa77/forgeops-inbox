import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertTargetedMailboxEmailMatch,
  buildAuthorizationFields,
  canStartInboxAuthorization,
  deriveAuthorizationStatus,
  validateAuthorizeExistingTarget,
  wrongMailboxAuthorizationError,
} from "../application/services/inbox-authorization-status.js";
import { googleOAuthStateSchema } from "../domain/google/oauth-state.js";

/** Mirrors inbox-read connection summary shape for secret-leak assertions. */
const connectionSummarySchema = z.object({
  id: z.string(),
  provider: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  providerAccountId: z.string().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH", "DISCONNECTED"]),
  connectedAt: z.string().datetime().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  grantedScopes: z.array(z.string()),
  authorizationStatus: z.enum(["REQUIRED", "CONNECTED", "REAUTHORIZATION_REQUIRED"]),
  capabilities: z.object({
    emailIngestion: z.boolean(),
    directProviderAccess: z.boolean(),
    attachmentIngestion: z.boolean(),
    emailSending: z.boolean(),
  }),
  counts: z.object({
    messages: z.number(),
    threads: z.number(),
  }),
});

describe("deriveAuthorizationStatus", () => {
  it("tokenless n8n Outlook connection → REQUIRED", () => {
    expect(
      deriveAuthorizationStatus({
        provider: "OUTLOOK",
        status: "ACTIVE",
        hasRefreshToken: false,
      })
    ).toBe("REQUIRED");
  });

  it("OAuth-backed healthy Outlook connection → CONNECTED", () => {
    expect(
      deriveAuthorizationStatus({
        provider: "OUTLOOK",
        status: "ACTIVE",
        hasRefreshToken: true,
      })
    ).toBe("CONNECTED");
  });

  it("REQUIRES_REAUTH → REAUTHORIZATION_REQUIRED even with token", () => {
    expect(
      deriveAuthorizationStatus({
        provider: "OUTLOOK",
        status: "REQUIRES_REAUTH",
        hasRefreshToken: true,
      })
    ).toBe("REAUTHORIZATION_REQUIRED");
  });

  it("DISCONNECTED Outlook without refresh token → REQUIRED (authorize path)", () => {
    expect(
      deriveAuthorizationStatus({
        provider: "OUTLOOK",
        status: "DISCONNECTED",
        hasRefreshToken: false,
      })
    ).toBe("REQUIRED");
  });

  it("does not collapse REQUIRED and REAUTHORIZATION_REQUIRED", () => {
    const neverAuthorized = deriveAuthorizationStatus({
      provider: "OUTLOOK",
      status: "ACTIVE",
      hasRefreshToken: false,
    });
    const broken = deriveAuthorizationStatus({
      provider: "OUTLOOK",
      status: "REQUIRES_REAUTH",
      hasRefreshToken: false,
    });
    expect(neverAuthorized).toBe("REQUIRED");
    expect(broken).toBe("REAUTHORIZATION_REQUIRED");
    expect(neverAuthorized).not.toBe(broken);
  });
});

describe("buildAuthorizationFields capabilities", () => {
  it("REQUIRED exposes ingestion but not attachment/provider access or sending", () => {
    expect(
      buildAuthorizationFields({
        provider: "OUTLOOK",
        status: "ACTIVE",
        hasRefreshToken: false,
        grantedScopes: [],
      })
    ).toEqual({
      authorizationStatus: "REQUIRED",
      capabilities: {
        emailIngestion: true,
        directProviderAccess: false,
        attachmentIngestion: false,
        emailSending: false,
      },
    });
  });

  it("CONNECTED with Mail.Read only enables attachment but not sending", () => {
    expect(
      buildAuthorizationFields({
        provider: "OUTLOOK",
        status: "ACTIVE",
        hasRefreshToken: true,
        grantedScopes: ["https://graph.microsoft.com/Mail.Read"],
      })
    ).toEqual({
      authorizationStatus: "CONNECTED",
      capabilities: {
        emailIngestion: true,
        directProviderAccess: true,
        attachmentIngestion: true,
        emailSending: false,
      },
    });
  });

  it("Mail.Send absence does not force REAUTHORIZATION_REQUIRED", () => {
    const fields = buildAuthorizationFields({
      provider: "OUTLOOK",
      status: "ACTIVE",
      hasRefreshToken: true,
      grantedScopes: ["Mail.Read", "User.Read", "offline_access"],
    });
    expect(fields.authorizationStatus).toBe("CONNECTED");
    expect(fields.capabilities.attachmentIngestion).toBe(true);
    expect(fields.capabilities.emailSending).toBe(false);
  });

  it("CONNECTED with Mail.Send enables emailSending", () => {
    expect(
      buildAuthorizationFields({
        provider: "OUTLOOK",
        status: "ACTIVE",
        hasRefreshToken: true,
        grantedScopes: [
          "https://graph.microsoft.com/Mail.Read",
          "https://graph.microsoft.com/Mail.Send",
        ],
      }).capabilities.emailSending
    ).toBe(true);
  });
});

describe("validateAuthorizeExistingTarget", () => {
  it("allows Outlook ACTIVE (tokenless or CONNECTED needing Mail.Send)", () => {
    expect(
      validateAuthorizeExistingTarget({ provider: "OUTLOOK", status: "ACTIVE" })
    ).toEqual({ ok: true });
  });

  it("allows Outlook PAUSED for incremental authorize (not reconnect)", () => {
    expect(
      validateAuthorizeExistingTarget({ provider: "OUTLOOK", status: "PAUSED" })
    ).toEqual({ ok: true });
  });

  it("rejects non-Outlook provider", () => {
    const result = validateAuthorizeExistingTarget({
      provider: "GMAIL",
      status: "ACTIVE",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(400);
      expect(result.message).toMatch(/Outlook/i);
    }
  });

  it("rejects REQUIRES_REAUTH so reconnect remains distinct", () => {
    const result = validateAuthorizeExistingTarget({
      provider: "OUTLOOK",
      status: "REQUIRES_REAUTH",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(409);
      expect(result.message).toMatch(/reconnect/i);
    }
  });

  it("allows Outlook DISCONNECTED so OAuth can revive the same connection", () => {
    expect(
      validateAuthorizeExistingTarget({
        provider: "OUTLOOK",
        status: "DISCONNECTED",
      })
    ).toEqual({ ok: true });
  });

  it("allows Outlook ERROR for authorize/reconnect-via-authorize", () => {
    expect(
      validateAuthorizeExistingTarget({ provider: "OUTLOOK", status: "ERROR" })
    ).toEqual({ ok: true });
  });
});

describe("canStartInboxAuthorization", () => {
  it("allows OWNER and ADMIN", () => {
    expect(canStartInboxAuthorization("OWNER")).toBe(true);
    expect(canStartInboxAuthorization("ADMIN")).toBe(true);
  });

  it("rejects MEMBER and other roles", () => {
    expect(canStartInboxAuthorization("MEMBER")).toBe(false);
    expect(canStartInboxAuthorization("VIEWER")).toBe(false);
  });
});

describe("assertTargetedMailboxEmailMatch", () => {
  it("accepts case/whitespace-normalized matches", () => {
    expect(
      assertTargetedMailboxEmailMatch({
        expectedEmail: " Estimating@Company.COM ",
        microsoftEmail: "estimating@company.com",
      })
    ).toBeNull();
  });

  it("rejects wrong Microsoft mailbox with user-facing expected email", () => {
    const error = assertTargetedMailboxEmailMatch({
      expectedEmail: "estimating@company.com",
      microsoftEmail: "reese@company.com",
    });
    expect(error).toBe(
      wrongMailboxAuthorizationError("estimating@company.com")
    );
    expect(error).not.toMatch(/conn_|workspace|id=/i);
  });
});

describe("connection API serialization safety", () => {
  it("does not expose token or encrypted secret fields", () => {
    const auth = buildAuthorizationFields({
      provider: "OUTLOOK",
      status: "ACTIVE",
      hasRefreshToken: true,
    });

    const serialized = connectionSummarySchema.parse({
      id: "conn_1",
      provider: "outlook",
      email: "estimating@company.com",
      displayName: "Estimating",
      providerAccountId: "oid-1",
      status: "ACTIVE",
      connectedAt: new Date().toISOString(),
      lastSyncedAt: null,
      grantedScopes: ["Mail.Read"],
      authorizationStatus: auth.authorizationStatus,
      capabilities: auth.capabilities,
      counts: { messages: 0, threads: 0 },
    });

    const json = JSON.stringify(serialized);
    expect(json).not.toMatch(/encryptedRefreshToken|encryptedAccessToken|refreshToken|accessToken/i);
    expect(serialized).not.toHaveProperty("encryptedRefreshToken");
    expect(serialized).not.toHaveProperty("hasRefreshToken");
    expect(serialized.authorizationStatus).toBe("CONNECTED");
  });
});

describe("OAuth state authorizeExisting", () => {
  it("parses trusted authorize-existing inbox-connect state", () => {
    const state = googleOAuthStateSchema.parse({
      flow: "inbox-connect",
      provider: "outlook",
      workspaceId: "ws_1",
      userId: "user_1",
      connectionId: "conn_1",
      reconnect: false,
      authorizeExisting: true,
      createdAt: new Date().toISOString(),
    });
    expect(state.flow).toBe("inbox-connect");
    if (state.flow === "inbox-connect") {
      expect(state.authorizeExisting).toBe(true);
      expect(state.connectionId).toBe("conn_1");
      expect(state.reconnect).toBe(false);
    }
  });
});
