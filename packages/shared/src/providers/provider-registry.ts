import type {
  InboxOAuthProvider,
  InboxProviderKind,
  InboxSyncProvider
} from "../types/provider.js";

export class ProviderRegistry {
  private readonly oauthProviders = new Map<InboxProviderKind, InboxOAuthProvider>();
  private readonly syncProviders = new Map<InboxProviderKind, InboxSyncProvider>();

  registerOAuthProvider(provider: InboxOAuthProvider): void {
    this.oauthProviders.set(provider.kind, provider);
  }

  registerSyncProvider(provider: InboxSyncProvider): void {
    this.syncProviders.set(provider.kind, provider);
  }

  getOAuthProvider(kind: InboxProviderKind): InboxOAuthProvider {
    const provider = this.oauthProviders.get(kind);
    if (!provider) {
      throw new Error(`No OAuth provider registered for: ${kind}`);
    }
    return provider;
  }

  getSyncProvider(kind: InboxProviderKind): InboxSyncProvider {
    const provider = this.syncProviders.get(kind);
    if (!provider) {
      throw new Error(`No sync provider registered for: ${kind}`);
    }
    return provider;
  }

  hasOAuthProvider(kind: InboxProviderKind): boolean {
    return this.oauthProviders.has(kind);
  }

  hasSyncProvider(kind: InboxProviderKind): boolean {
    return this.syncProviders.has(kind);
  }

  get registeredOAuthKinds(): InboxProviderKind[] {
    return [...this.oauthProviders.keys()];
  }

  get registeredSyncKinds(): InboxProviderKind[] {
    return [...this.syncProviders.keys()];
  }
}
