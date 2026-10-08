import { normalizeEmail } from "@forgeops/shared";

/**
 * Pure helpers for Platform Admin delegated mailbox onboarding.
 * OAuth identity may differ from the target mailbox; Graph must verify access.
 */

export function buildDelegatedAuthorizeOAuthState(input: {
  workspaceId: string;
  userId: string;
  connectionId: string;
  targetMailboxEmail: string;
  createdAt?: string;
}): {
  flow: "inbox-connect";
  provider: "outlook";
  workspaceId: string;
  userId: string;
  connectionId: string;
  reconnect: false;
  authorizeExisting: true;
  delegatedMailboxAccess: true;
  targetMailboxEmail: string;
  createdAt: string;
} {
  return {
    flow: "inbox-connect",
    provider: "outlook",
    workspaceId: input.workspaceId,
    userId: input.userId,
    connectionId: input.connectionId,
    reconnect: false,
    authorizeExisting: true,
    delegatedMailboxAccess: true,
    targetMailboxEmail: normalizeEmail(input.targetMailboxEmail),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/** Fail closed if OAuth state target was swapped vs the InboxConnection email. */
export function assertDelegatedTargetMatchesConnection(input: {
  stateTargetMailboxEmail: string | undefined;
  connectionEmail: string;
}): string | null {
  if (!input.stateTargetMailboxEmail) {
    return "Delegated OAuth state is missing targetMailboxEmail";
  }
  if (
    normalizeEmail(input.stateTargetMailboxEmail) !==
    normalizeEmail(input.connectionEmail)
  ) {
    return "OAuth state target mailbox does not match the InboxConnection being authorized";
  }
  return null;
}

/**
 * Resolve which Graph mailbox resource to use after a successful delegated callback.
 * Connection.email (target) is preserved; oauthAccountEmail is the Microsoft identity.
 */
export function resolveDelegatedConnectionIdentity(input: {
  connectionEmail: string;
  microsoftEmail: string;
  delegatedMailboxAccess: boolean;
}): {
  email: string;
  oauthAccountEmail: string;
  delegatedMailboxAccess: boolean;
} {
  const target = normalizeEmail(input.connectionEmail);
  const oauth = normalizeEmail(input.microsoftEmail);
  const delegated =
    input.delegatedMailboxAccess || (target.length > 0 && target !== oauth);
  return {
    email: target,
    oauthAccountEmail: oauth,
    delegatedMailboxAccess: delegated,
  };
}

export function canUsePlatformAdminMailboxOnboarding(platformRole: string | null | undefined): boolean {
  return platformRole === "PLATFORM_ADMIN";
}
