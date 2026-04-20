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
  "https://graph.microsoft.com/User.Read"
] as const;

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
    url.searchParams.set("prompt", "consent");

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
    const grantedScopes = tokens.scope?.split(" ").filter(Boolean) ?? [];

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
    const email = profile.mail ?? profile.userPrincipalName;

    return {
      subject: profile.id,
      email: email.toLowerCase(),
      emailVerified: true,
      name: profile.displayName ?? null,
      picture: null
    };
  }

  async disconnect(): Promise<void> {}
}
