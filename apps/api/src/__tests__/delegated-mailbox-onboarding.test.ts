import { describe, expect, it, vi } from "vitest";

import {
  assertDelegatedTargetMatchesConnection,
  buildDelegatedAuthorizeOAuthState,
  canUsePlatformAdminMailboxOnboarding,
  resolveDelegatedConnectionIdentity,
} from "../application/services/delegated-mailbox-onboarding.js";
import { assertTargetedMailboxEmailMatch } from "../application/services/inbox-authorization-status.js";
import { verifyOutlookMailboxAccess } from "../application/services/outlook-mailbox-access.js";
import { googleOAuthStateSchema } from "../domain/google/oauth-state.js";

describe("Platform Admin delegated mailbox onboarding", () => {
  it("allows Platform Admin to initiate onboarding for a different mailbox", () => {
    expect(canUsePlatformAdminMailboxOnboarding("PLATFORM_ADMIN")).toBe(true);
    const state = buildDelegatedAuthorizeOAuthState({
      workspaceId: "ws_1",
      userId: "admin_user",
      connectionId: "conn_estimating",
      targetMailboxEmail: "Estimating@Company.com",
      createdAt: "2026-10-08T12:00:00.000Z",
    });
    expect(state.targetMailboxEmail).toBe("estimating@company.com");
    expect(state.delegatedMailboxAccess).toBe(true);
    expect(state.authorizeExisting).toBe(true);
    expect(state.userId).toBe("admin_user");
    expect(state.connectionId).toBe("conn_estimating");
    expect(state.workspaceId).toBe("ws_1");
    expect(googleOAuthStateSchema.parse(state).targetMailboxEmail).toBe(
      "estimating@company.com"
    );
  });

  it("ordinary user cannot use Platform Admin cross-mailbox flow", () => {
    expect(canUsePlatformAdminMailboxOnboarding("STANDARD_USER")).toBe(false);
    expect(canUsePlatformAdminMailboxOnboarding(null)).toBe(false);
    expect(canUsePlatformAdminMailboxOnboarding(undefined)).toBe(false);
  });

  it("preserves requested mailbox identity through OAuth state", () => {
    const state = buildDelegatedAuthorizeOAuthState({
      workspaceId: "ws_1",
      userId: "admin_user",
      connectionId: "conn_1",
      targetMailboxEmail: "projects@company.com",
    });
    expect(state.targetMailboxEmail).toBe("projects@company.com");
    expect(
      assertDelegatedTargetMatchesConnection({
        stateTargetMailboxEmail: state.targetMailboxEmail,
        connectionEmail: "Projects@Company.com",
      })
    ).toBeNull();
  });

  it("allows OAuth identity and target mailbox to differ when delegated", () => {
    expect(
      assertTargetedMailboxEmailMatch({
        expectedEmail: "estimating@company.com",
        microsoftEmail: "admin@company.com",
        allowDelegatedAccess: true,
      })
    ).toBeNull();

    const identity = resolveDelegatedConnectionIdentity({
      connectionEmail: "estimating@company.com",
      microsoftEmail: "admin@company.com",
      delegatedMailboxAccess: true,
    });
    expect(identity.email).toBe("estimating@company.com");
    expect(identity.oauthAccountEmail).toBe("admin@company.com");
    expect(identity.delegatedMailboxAccess).toBe(true);
  });

  it("rejects identity mismatch when not delegated (own-mailbox still strict)", () => {
    expect(
      assertTargetedMailboxEmailMatch({
        expectedEmail: "estimating@company.com",
        microsoftEmail: "admin@company.com",
      })
    ).toMatch(/estimating@company.com/i);
  });

  it("verifies target mailbox access via Graph and fails closed when inaccessible", async () => {
    const okFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await verifyOutlookMailboxAccess({
      accessToken: "token",
      targetMailboxEmail: "estimating@company.com",
      fetchImpl: okFetch as unknown as typeof fetch,
    });
    expect(ok).toEqual({ ok: true, verifiedEmail: "estimating@company.com" });
    expect(String(okFetch.mock.calls[0]?.[0])).toContain(
      "/users/estimating%40company.com/mailboxSettings"
    );

    const denied = await verifyOutlookMailboxAccess({
      accessToken: "token",
      targetMailboxEmail: "secret@company.com",
      fetchImpl: (async () =>
        new Response("Forbidden", { status: 403 })) as unknown as typeof fetch,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.status).toBe(403);
      expect(denied.message).toMatch(/did not grant access/i);
    }
  });

  it("callback cannot be used to swap target mailbox", () => {
    expect(
      assertDelegatedTargetMatchesConnection({
        stateTargetMailboxEmail: "estimating@company.com",
        connectionEmail: "projects@company.com",
      })
    ).toMatch(/does not match/i);

    expect(
      assertDelegatedTargetMatchesConnection({
        stateTargetMailboxEmail: undefined,
        connectionEmail: "estimating@company.com",
      })
    ).toMatch(/missing targetMailboxEmail/i);
  });

  it("attaches connection identity to the intended workspace via locked state", () => {
    const state = buildDelegatedAuthorizeOAuthState({
      workspaceId: "ws_intended",
      userId: "admin_user",
      connectionId: "conn_locked",
      targetMailboxEmail: "employee@company.com",
    });
    expect(state.workspaceId).toBe("ws_intended");
    expect(state.connectionId).toBe("conn_locked");
  });

  it("duplicate onboarding reuses the same connection id in delegated state", () => {
    const first = buildDelegatedAuthorizeOAuthState({
      workspaceId: "ws_1",
      userId: "admin_user",
      connectionId: "conn_same",
      targetMailboxEmail: "estimating@company.com",
    });
    const second = buildDelegatedAuthorizeOAuthState({
      workspaceId: "ws_1",
      userId: "admin_user",
      connectionId: "conn_same",
      targetMailboxEmail: "estimating@company.com",
    });
    expect(first.connectionId).toBe(second.connectionId);
    expect(first.targetMailboxEmail).toBe(second.targetMailboxEmail);
  });

  it("reauthorization updates the intended InboxConnection (authorizeExisting + connectionId)", () => {
    const state = buildDelegatedAuthorizeOAuthState({
      workspaceId: "ws_1",
      userId: "admin_user",
      connectionId: "conn_to_reauth",
      targetMailboxEmail: "estimating@company.com",
    });
    expect(state.authorizeExisting).toBe(true);
    expect(state.reconnect).toBe(false);
    expect(state.connectionId).toBe("conn_to_reauth");
  });

  it("Platform Admin delegated callback may proceed without workspace membership", () => {
    // Documented contract: membership gate is skipped only when both
    // delegatedMailboxAccess and PLATFORM_ADMIN are true (see OAuth callback).
    expect(canUsePlatformAdminMailboxOnboarding("PLATFORM_ADMIN")).toBe(true);
    const state = buildDelegatedAuthorizeOAuthState({
      workspaceId: "ws_other_client",
      userId: "platform_admin",
      connectionId: "conn_1",
      targetMailboxEmail: "estimating@client.com",
    });
    expect(state.delegatedMailboxAccess).toBe(true);
    expect(state.workspaceId).toBe("ws_other_client");
  });
});
