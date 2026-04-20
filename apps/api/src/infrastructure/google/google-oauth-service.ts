import { google } from "googleapis";
import { z } from "zod";

const GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_USERINFO_EMAIL_SCOPE =
  "https://www.googleapis.com/auth/userinfo.email";
const GOOGLE_USERINFO_PROFILE_SCOPE =
  "https://www.googleapis.com/auth/userinfo.profile";

export const googleAppAuthScopes = ["openid", "email", "profile"] as const;

export const googleInboxConnectionScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send"
] as const;

const googleScopeAliases: Record<string, readonly string[]> = {
  email: ["email", GOOGLE_USERINFO_EMAIL_SCOPE],
  [GOOGLE_USERINFO_EMAIL_SCOPE]: ["email", GOOGLE_USERINFO_EMAIL_SCOPE],
  profile: ["profile", GOOGLE_USERINFO_PROFILE_SCOPE],
  [GOOGLE_USERINFO_PROFILE_SCOPE]: ["profile", GOOGLE_USERINFO_PROFILE_SCOPE],
  openid: ["openid"]
};

const googleTokenSchema = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  expiry_date: z.number().optional(),
  token_type: z.string().optional(),
  id_token: z.string().optional()
});

const googleUserProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  verified_email: z.boolean().optional(),
  name: z.string().optional().nullable(),
  picture: z.string().url().optional().nullable()
});

export interface GoogleOAuthServiceConfig {
  clientId?: string;
  clientSecret?: string;
  authRedirectUri?: string;
  inboxRedirectUri?: string;
}

export interface GoogleTokenResult {
  accessToken: string | null;
  refreshToken: string | null;
  grantedScopes: string[];
  accessTokenExpiresAt: Date | null;
  idToken: string | null;
  tokenType: string | null;
}

export interface GoogleUserProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

type GoogleFlow = "app-auth" | "inbox-connect";

interface GoogleAuthorizationUrlOptions {
  flow: GoogleFlow;
  scopes: readonly string[];
  state: string;
  accessType?: "offline";
  prompt?: "consent" | "select_account";
}

export const normalizeGoogleGrantedScopes = (
  scopes: readonly string[]
): string[] => {
  const normalizedScopes = new Set<string>();

  for (const scope of scopes) {
    if (!scope) {
      continue;
    }

    normalizedScopes.add(scope);

    for (const alias of googleScopeAliases[scope] ?? []) {
      normalizedScopes.add(alias);
    }
  }

  return [...normalizedScopes];
};

export class GoogleOAuthService {
  constructor(private readonly config: GoogleOAuthServiceConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.clientId &&
        this.config.clientSecret &&
        this.config.authRedirectUri &&
        this.config.inboxRedirectUri
    );
  }

  getAuthRedirectUri(): string | null {
    return this.config.authRedirectUri ?? null;
  }

  getInboxRedirectUri(): string | null {
    return this.config.inboxRedirectUri ?? null;
  }

  createAppAuthUrl(state: string): string {
    return this.buildAuthorizationUrl({
      flow: "app-auth",
      scopes: googleAppAuthScopes,
      state,
      prompt: "select_account"
    });
  }

  createInboxConnectionUrl(state: string): string {
    return this.buildAuthorizationUrl({
      flow: "inbox-connect",
      scopes: googleInboxConnectionScopes,
      state,
      accessType: "offline",
      prompt: "consent"
    });
  }

  async exchangeCode(
    flow: GoogleFlow,
    code: string
  ): Promise<GoogleTokenResult> {
    const client = this.createClient(flow);
    const response = await client.getToken(code);
    const tokens = googleTokenSchema.parse(response.tokens);
    const grantedScopes = tokens.scope?.split(" ").filter(Boolean) ?? [];

    return {
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      grantedScopes,
      accessTokenExpiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : null,
      idToken: tokens.id_token ?? null,
      tokenType: tokens.token_type ?? null
    };
  }

  async fetchUserProfile(
    flow: GoogleFlow,
    accessToken: string
  ): Promise<GoogleUserProfile> {
    const client = this.createClient(flow);
    client.setCredentials({
      access_token: accessToken
    });

    const oauth2 = google.oauth2({
      version: "v2",
      auth: client
    });

    const response = await oauth2.userinfo.get();
    const profile = googleUserProfileSchema.parse(response.data);

    return {
      subject: profile.id,
      email: profile.email,
      emailVerified: profile.verified_email ?? false,
      name: profile.name ?? null,
      picture: profile.picture ?? null
    };
  }

  private createClient(flow: GoogleFlow) {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Google OAuth client credentials are not configured");
    }

    const redirectUri =
      flow === "app-auth"
        ? this.config.authRedirectUri
        : this.config.inboxRedirectUri;

    if (!redirectUri) {
      throw new Error(`Google OAuth redirect URI for ${flow} is not configured`);
    }

    return new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      redirectUri
    );
  }

  private buildAuthorizationUrl(
    options: GoogleAuthorizationUrlOptions
  ): string {
    if (!this.config.clientId) {
      throw new Error("Google OAuth client ID is not configured");
    }

    const redirectUri =
      options.flow === "app-auth"
        ? this.config.authRedirectUri
        : this.config.inboxRedirectUri;

    if (!redirectUri) {
      throw new Error(
        `Google OAuth redirect URI for ${options.flow} is not configured`
      );
    }

    const url = new URL(GOOGLE_AUTH_BASE_URL);

    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", [...options.scopes].join(" "));
    url.searchParams.set("state", options.state);

    if (options.accessType) {
      url.searchParams.set("access_type", options.accessType);
    }

    if (options.prompt) {
      url.searchParams.set("prompt", options.prompt);
    }

    const finalUrl = url.toString();
    const expectedAuthorizationUrl: {
      clientId: string;
      redirectUri: string;
      responseType: "code";
      scope: string;
      state: string;
      accessType?: "offline";
      prompt?: "consent" | "select_account";
    } = {
      clientId: this.config.clientId,
      redirectUri,
      responseType: "code",
      scope: [...options.scopes].join(" "),
      state: options.state,
      ...(options.accessType ? { accessType: options.accessType } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {})
    };
    this.assertAuthorizationUrl(finalUrl, expectedAuthorizationUrl);

    return finalUrl;
  }

  private assertAuthorizationUrl(
    authorizationUrl: string,
    expected: {
      clientId: string;
      redirectUri: string;
      responseType: "code";
      scope: string;
      state: string;
      accessType?: "offline";
      prompt?: "consent" | "select_account";
    }
  ): void {
    const parsedUrl = new URL(authorizationUrl);

    if (parsedUrl.searchParams.get("client_id") !== expected.clientId) {
      throw new Error("Generated Google OAuth URL is missing client_id");
    }

    if (parsedUrl.searchParams.get("redirect_uri") !== expected.redirectUri) {
      throw new Error("Generated Google OAuth URL has an invalid redirect_uri");
    }

    if (
      parsedUrl.searchParams.get("response_type") !== expected.responseType
    ) {
      throw new Error("Generated Google OAuth URL is missing response_type=code");
    }

    if (parsedUrl.searchParams.get("scope") !== expected.scope) {
      throw new Error("Generated Google OAuth URL has an invalid scope value");
    }

    if (parsedUrl.searchParams.get("state") !== expected.state) {
      throw new Error("Generated Google OAuth URL is missing state");
    }

    if (
      expected.accessType &&
      parsedUrl.searchParams.get("access_type") !== expected.accessType
    ) {
      throw new Error("Generated Google OAuth URL is missing access_type=offline");
    }

    if (
      expected.prompt &&
      parsedUrl.searchParams.get("prompt") !== expected.prompt
    ) {
      throw new Error("Generated Google OAuth URL is missing prompt=consent");
    }
  }
}
