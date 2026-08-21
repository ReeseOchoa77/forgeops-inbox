import { z } from "zod";

import type {
  InboxOAuthProvider,
  ProviderAuthorizationUrlInput,
  ProviderTokenResult,
  ProviderUserProfile
} from "@forgeops/shared";

const MICROSOFT_AUTH_BASE_URL = "https://login.microsoftonline.com";
const MICROSOFT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

export const outlookInboxConnectionScopes = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/User.Read"
] as const;

/**
 * Microsoft often omits OIDC / offline_access from the token response `scope`
 * even when they were granted. Presence of a refresh_token is the signal for
 * offline_access; id_token for openid.
 */
export function coalesceMicrosoftGrantedScopes(input: {
  scope?: string | undefined;
  refreshToken?: string | null | undefined;
  idToken?: string | null | undefined;
}): string[] {
  const granted = input.scope?.split(/\s+/).filter(Boolean) ?? [];
  if (input.refreshToken && !granted.includes("offline_access")) {
    granted.push("offline_access");
  }
  if (input.idToken && !granted.includes("openid")) {
    granted.push("openid");
  }
  return granted;
}

const microsoftTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
  id_token: z.string().optional()
});

const microsoftUserProfileSchema = z.object({
  id: z.string().min(1),
  mail: z.string().email().nullable().optional(),
  userPrincipalName: z.string().min(1),
  displayName: z.string().nullable().optional()
});

/**
 * Resolve the Microsoft Graph /me identity email used for mailbox matching.
 * Precedence: `mail` (primary SMTP) if present, else `userPrincipalName`.
 * Does not use preferred_username / other ID token claims — Graph /me only.
 */
export function resolveOutlookGraphProfileEmail(profile: {
  mail?: string | null | undefined;
  userPrincipalName: string;
}): {
  email: string;
  emailSource: "mail" | "userPrincipalName";
  graphMail: string | null;
  graphUserPrincipalName: string;
} {
  const graphMail =
    typeof profile.mail === "string" && profile.mail.trim()
      ? profile.mail.trim()
      : null;
  const graphUserPrincipalName = profile.userPrincipalName.trim();

  if (graphMail) {
    return {
      email: graphMail.toLowerCase(),
      emailSource: "mail",
      graphMail,
      graphUserPrincipalName,
    };
  }

  return {
    email: graphUserPrincipalName.toLowerCase(),
    emailSource: "userPrincipalName",
    graphMail: null,
    graphUserPrincipalName,
  };
}

export interface OutlookOAuthProviderConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  tenantId?: string;
}

export class OutlookOAuthProvider implements InboxOAuthProvider {
  readonly kind = "outlook" as const;

  constructor(private readonly config: OutlookOAuthProviderConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.clientId &&
        this.config.clientSecret &&
        this.config.redirectUri
    );
  }

  getRequiredScopes(): readonly string[] {
    return outlookInboxConnectionScopes;
  }

  normalizeGrantedScopes(scopes: readonly string[]): string[] {
    const GRAPH_PREFIX = "https://graph.microsoft.com/";
    const normalized = new Set<string>();

    for (const scope of scopes) {
      if (!scope) continue;
      normalized.add(scope);

      if (scope.startsWith(GRAPH_PREFIX)) {
        normalized.add(scope.slice(GRAPH_PREFIX.length));
      } else if (
        !scope.includes("/") &&
        !scope.includes(":") &&
        /^[A-Z]/.test(scope)
      ) {
        normalized.add(`${GRAPH_PREFIX}${scope}`);
      }
    }

    return [...normalized];
  }

  getAuthorizationUrl(input: ProviderAuthorizationUrlInput): string {
    if (!this.config.clientId || !this.config.redirectUri) {
      throw new Error("Outlook OAuth client credentials are not configured");
    }

    const tenantId = this.config.tenantId ?? "common";
    const url = new URL(
      `${MICROSOFT_AUTH_BASE_URL}/${tenantId}/oauth2/v2.0/authorize`
    );

    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      [...outlookInboxConnectionScopes].join(" ")
    );
    url.searchParams.set("state", input.state);
    url.searchParams.set("response_mode", "query");
    // select_account: let the user pick the exact mailbox for targeted authorize.
    // Do NOT use prompt=consent — that re-forces consent UI and can demand admin
    // approval again even after tenant-wide admin consent for this app.
    url.searchParams.set("prompt", "select_account");

    return url.toString();
  }

  async exchangeCode(code: string): Promise<ProviderTokenResult> {
    if (
      !this.config.clientId ||
      !this.config.clientSecret ||
      !this.config.redirectUri
    ) {
      throw new Error("Outlook OAuth client credentials are not configured");
    }

    const tenantId = this.config.tenantId ?? "common";
    const tokenUrl = `${MICROSOFT_AUTH_BASE_URL}/${tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
      scope: [...outlookInboxConnectionScopes].join(" ")
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Outlook token exchange failed (${response.status}): ${errorText}`
      );
    }

    const raw = await response.json();
    const tokens = microsoftTokenSchema.parse(raw);
    const grantedScopes = coalesceMicrosoftGrantedScopes({
      scope: tokens.scope,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      grantedScopes,
      accessTokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
      idToken: tokens.id_token ?? null,
      tokenType: tokens.token_type ?? null
    };
  }

  async fetchUserProfile(accessToken: string): Promise<ProviderUserProfile> {
    const { profile } =
      await this.fetchUserProfileWithIdentityDiagnostics(accessToken);
    return profile;
  }

  /**
   * Graph /me profile plus safe identity-field diagnostics (no tokens).
   * Matching still uses resolved `profile.email` only (`mail` then UPN).
   */
  async fetchUserProfileWithIdentityDiagnostics(accessToken: string): Promise<{
    profile: ProviderUserProfile;
    identity: ReturnType<typeof resolveOutlookGraphProfileEmail>;
  }> {
    const response = await fetch(`${MICROSOFT_GRAPH_BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Outlook user profile fetch failed (${response.status}): ${errorText}`
      );
    }

    const raw = await response.json();
    const profile = microsoftUserProfileSchema.parse(raw);
    const identity = resolveOutlookGraphProfileEmail(profile);

    return {
      profile: {
        subject: profile.id,
        email: identity.email,
        emailVerified: true,
        name: profile.displayName ?? null,
        picture: null
      },
      identity
    };
  }


  async disconnect(): Promise<void> {}
}

/**
 * Diagnostic-only: read email-related claims from a Microsoft id_token payload.
 * Does not verify the JWT. Never used for mailbox matching.
 */
export function peekMicrosoftIdTokenIdentityClaims(
  idToken: string | null | undefined
): {
  preferredUsername: string | null;
  emailClaim: string | null;
} {
  if (!idToken || typeof idToken !== "string") {
    return { preferredUsername: null, emailClaim: null };
  }
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) {
    return { preferredUsername: null, emailClaim: null };
  }
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as {
      preferred_username?: unknown;
      email?: unknown;
    };
    return {
      preferredUsername:
        typeof payload.preferred_username === "string" &&
        payload.preferred_username.trim()
          ? payload.preferred_username.trim()
          : null,
      emailClaim:
        typeof payload.email === "string" && payload.email.trim()
          ? payload.email.trim()
          : null,
    };
  } catch {
    return { preferredUsername: null, emailClaim: null };
  }
}

/**
 * Callback-side Outlook required-scope check. Re-applies refresh/id-token
 * coalescing so validation does not depend solely on tokenResponse.scope.
 */
export function findMissingOutlookRequiredScopes(input: {
  grantedScopes: readonly string[];
  hasRefreshToken: boolean;
  hasIdToken: boolean;
}): string[] {
  const coalesced = coalesceMicrosoftGrantedScopes({
    scope: input.grantedScopes.join(" "),
    refreshToken: input.hasRefreshToken ? "present" : null,
    idToken: input.hasIdToken ? "present" : null,
  });

  const provider = new OutlookOAuthProvider({});
  const normalized = provider.normalizeGrantedScopes(coalesced);
  return outlookInboxConnectionScopes.filter(
    (scope) => !normalized.includes(scope)
  );
}

