import type { InboxConnectionStatus, InboxProvider } from "@prisma/client";
import { normalizeEmail } from "@forgeops/shared";

export type AuthorizationStatus =
  | "REQUIRED"
  | "CONNECTED"
  | "REAUTHORIZATION_REQUIRED";

export type InboxConnectionCapabilities = {
  emailIngestion: boolean;
  directProviderAccess: boolean;
  attachmentIngestion: boolean;
};

/**
 * Derive a safe, user-facing authorization status from connection fields.
 * Never expose token material — callers pass a boolean derived server-side.
 */
export function deriveAuthorizationStatus(input: {
  provider: InboxProvider | string;
  status: InboxConnectionStatus | string;
  hasRefreshToken: boolean;
}): AuthorizationStatus {
  if (input.status === "REQUIRES_REAUTH") {
    return "REAUTHORIZATION_REQUIRED";
  }

  const provider = String(input.provider).toUpperCase();
  if (provider === "OUTLOOK" && !input.hasRefreshToken) {
    return "REQUIRED";
  }

  if (input.hasRefreshToken && input.status !== "DISCONNECTED") {
    return "CONNECTED";
  }

  // Gmail without token (unusual) or disconnected Outlook with no token
  if (!input.hasRefreshToken) {
    return "REQUIRED";
  }

  return "CONNECTED";
}

export function deriveInboxCapabilities(input: {
  authorizationStatus: AuthorizationStatus;
  status: InboxConnectionStatus | string;
}): InboxConnectionCapabilities {
  const activeEnough =
    input.status !== "DISCONNECTED" && input.status !== "PAUSED";
  const oauthReady = input.authorizationStatus === "CONNECTED";

  return {
    emailIngestion: activeEnough,
    directProviderAccess: oauthReady,
    attachmentIngestion: oauthReady,
  };
}

export function buildAuthorizationFields(input: {
  provider: InboxProvider | string;
  status: InboxConnectionStatus | string;
  hasRefreshToken: boolean;
}): {
  authorizationStatus: AuthorizationStatus;
  capabilities: InboxConnectionCapabilities;
} {
  const authorizationStatus = deriveAuthorizationStatus(input);
  return {
    authorizationStatus,
    capabilities: deriveInboxCapabilities({
      authorizationStatus,
      status: input.status,
    }),
  };
}

/** User-facing wrong-mailbox error (no internal IDs). */
export function wrongMailboxAuthorizationError(expectedEmail: string): string {
  return (
    `You authorized a different Microsoft mailbox. ` +
    `Sign in with ${expectedEmail} to finish connecting this mailbox.`
  );
}

/**
 * Validate that an InboxConnection can be targeted by the authorize-existing flow.
 * Reconnect remains the path for REQUIRES_REAUTH.
 */
export function validateAuthorizeExistingTarget(connection: {
  provider: InboxProvider | string;
  status: InboxConnectionStatus | string;
}):
  | { ok: true }
  | { ok: false; statusCode: 400 | 409; message: string } {
  const provider = String(connection.provider).toUpperCase();
  if (provider !== "OUTLOOK") {
    return {
      ok: false,
      statusCode: 400,
      message: "Only Outlook mailbox connections can be authorized with this flow",
    };
  }

  if (connection.status === "REQUIRES_REAUTH") {
    return {
      ok: false,
      statusCode: 409,
      message:
        "This mailbox requires reauthorization. Use the reconnect endpoint instead.",
    };
  }

  if (connection.status === "DISCONNECTED") {
    return {
      ok: false,
      statusCode: 400,
      message: "Disconnected mailbox connections cannot be authorized",
    };
  }

  return { ok: true };
}

/**
 * Strict mailbox match for targeted OAuth (authorize-existing / reconnect).
 * Returns null when emails match after normalizeEmail; otherwise a user-facing error.
 */
export function assertTargetedMailboxEmailMatch(input: {
  expectedEmail: string;
  microsoftEmail: string;
}): string | null {
  const expected = normalizeEmail(input.expectedEmail);
  const actual = normalizeEmail(input.microsoftEmail);
  if (expected === actual) {
    return null;
  }
  return wrongMailboxAuthorizationError(expected);
}
