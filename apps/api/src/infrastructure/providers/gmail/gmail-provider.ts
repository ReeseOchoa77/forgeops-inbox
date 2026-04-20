import type {
  InboxOAuthProvider,
  ProviderAuthorizationUrlInput,
  ProviderTokenResult,
  ProviderUserProfile
} from "@forgeops/shared";

import {
  GoogleOAuthService,
  googleInboxConnectionScopes,
  normalizeGoogleGrantedScopes,
  type GoogleOAuthServiceConfig
} from "../../google/google-oauth-service.js";

export class GmailOAuthProvider implements InboxOAuthProvider {
  readonly kind = "gmail" as const;
  private readonly oauthService: GoogleOAuthService;

  constructor(config: GoogleOAuthServiceConfig) {
    this.oauthService = new GoogleOAuthService(config);
  }

  isConfigured(): boolean {
    return this.oauthService.isConfigured();
  }

  getRequiredScopes(): readonly string[] {
    return googleInboxConnectionScopes;
  }

  normalizeGrantedScopes(scopes: readonly string[]): string[] {
    return normalizeGoogleGrantedScopes(scopes);
  }

  getAuthorizationUrl(input: ProviderAuthorizationUrlInput): string {
    return this.oauthService.createInboxConnectionUrl(input.state);
  }

  async exchangeCode(code: string): Promise<ProviderTokenResult> {
    const tokens = await this.oauthService.exchangeCode("inbox-connect", code);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      grantedScopes: tokens.grantedScopes,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      idToken: tokens.idToken,
      tokenType: tokens.tokenType
    };
  }

  async fetchUserProfile(accessToken: string): Promise<ProviderUserProfile> {
    const profile = await this.oauthService.fetchUserProfile(
      "inbox-connect",
      accessToken
    );
    return {
      subject: profile.subject,
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: profile.name,
      picture: profile.picture
    };
  }

  async disconnect(): Promise<void> {}
}
