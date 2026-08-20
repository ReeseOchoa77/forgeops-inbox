import { describe, expect, it } from "vitest";

import {
  coalesceMicrosoftGrantedScopes,
  findMissingOutlookRequiredScopes,
  OutlookOAuthProvider,
  outlookInboxConnectionScopes,
} from "../infrastructure/providers/outlook/outlook-provider.js";

describe("Outlook OAuth scopes", () => {
  it("authorization URL for inbox connect includes required Microsoft scopes", () => {
    const provider = new OutlookOAuthProvider({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      redirectUri: "https://api.example.com/api/v1/inbox-connections/google/callback",
      tenantId: "common",
    });

    // Targeted authorize / reconnect / connect all call the same getAuthorizationUrl.
    const url = new URL(provider.getAuthorizationUrl({ state: "state-authorize-existing" }));
    const scope = url.searchParams.get("scope") ?? "";

    expect(scope).toContain("offline_access");
    expect(scope).toContain("openid");
    expect(scope).toContain("https://graph.microsoft.com/Mail.Read");
    expect(scope).toContain("https://graph.microsoft.com/User.Read");
    expect(scope).toContain("email");
    expect(scope).toContain("profile");

    for (const required of outlookInboxConnectionScopes) {
      expect(scope.split(/\s+/)).toContain(required);
    }
  });

  it("authorization URL uses select_account and does not force consent", () => {
    const provider = new OutlookOAuthProvider({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      redirectUri: "https://api.example.com/callback",
      tenantId: "common",
    });

    const url = new URL(
      provider.getAuthorizationUrl({ state: "state-authorize-existing" })
    );

    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("prompt")).not.toBe("consent");
    // Delegated OAuth authorize endpoint (not client-credentials / app-only).
    expect(url.pathname).toContain("/oauth2/v2.0/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("getRequiredScopes matches the authorize URL scope list", () => {
    const provider = new OutlookOAuthProvider({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      redirectUri: "https://api.example.com/callback",
    });
    expect([...provider.getRequiredScopes()]).toEqual([...outlookInboxConnectionScopes]);
  });

  it("infers offline_access from refresh_token when Microsoft omits it from scope", () => {
    const granted = coalesceMicrosoftGrantedScopes({
      scope:
        "openid email profile https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read",
      refreshToken: "rt_abc",
      idToken: "id_abc",
    });

    expect(granted).toContain("offline_access");
    expect(granted).toContain("openid");
    expect(granted).toContain("https://graph.microsoft.com/Mail.Read");
  });

  it("does not invent offline_access without a refresh token", () => {
    const granted = coalesceMicrosoftGrantedScopes({
      scope: "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read",
      refreshToken: null,
    });
    expect(granted).not.toContain("offline_access");
  });

  it("callback validation passes when scope omits offline_access/openid but tokens are present", () => {
    // Realistic Microsoft tokenResponse.scope shape (short Graph names, no offline_access).
    const missing = findMissingOutlookRequiredScopes({
      grantedScopes: ["Mail.Read", "User.Read", "email", "profile"],
      hasRefreshToken: true,
      hasIdToken: true,
    });

    expect(missing).toEqual([]);
  });

  it("callback validation fails when offline_access missing and no refresh_token", () => {
    const missing = findMissingOutlookRequiredScopes({
      grantedScopes: ["Mail.Read", "User.Read", "email", "profile"],
      hasRefreshToken: false,
      hasIdToken: true,
    });

    expect(missing).toContain("offline_access");
    expect(missing).not.toContain("openid");
  });
});
