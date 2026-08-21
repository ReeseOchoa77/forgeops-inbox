import { normalizeEmail } from "@forgeops/shared";
import type { InboxConnectionStatus, InboxProvider } from "@prisma/client";

export type SendDenialCode =
  | "MAILBOX_IDENTITY_MISMATCH"
  | "CONNECTION_NOT_ACTIVE"
  | "MAILBOX_AUTH_REQUIRED"
  | "MAILBOX_REAUTH_REQUIRED"
  | "SEND_SCOPE_MISSING"
  | "PROVIDER_UNSUPPORTED";

export type SendAuthorizationResult =
  | { ok: true }
  | {
      ok: false;
      statusCode: 403 | 409;
      code: SendDenialCode;
      message: string;
    };

const OUTLOOK_SEND_SCOPE_MARKERS = [
  "https://graph.microsoft.com/mail.send",
  "mail.send",
] as const;

const GMAIL_SEND_SCOPE_MARKERS = [
  "https://www.googleapis.com/auth/gmail.send",
  "gmail.send",
] as const;

function scopeSet(grantedScopes: readonly string[]): Set<string> {
  return new Set(grantedScopes.map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** True when stored OAuth scopes include provider send permission. */
export function connectionHasSendingScope(input: {
  provider: InboxProvider | string;
  grantedScopes: readonly string[];
}): boolean {
  const provider = String(input.provider).toUpperCase();
  const scopes = scopeSet(input.grantedScopes);

  if (provider === "OUTLOOK") {
    return OUTLOOK_SEND_SCOPE_MARKERS.some((m) => scopes.has(m));
  }
  if (provider === "GMAIL") {
    return GMAIL_SEND_SCOPE_MARKERS.some((m) => scopes.has(m));
  }
  return false;
}

export function userOwnsMailbox(userEmail: string, connectionEmail: string): boolean {
  return normalizeEmail(userEmail) === normalizeEmail(connectionEmail);
}

/**
 * MVP: user may send only as their own mailbox identity
 * (normalize(user.email) === normalize(connection.email)), plus send-capable OAuth.
 */
export function assertUserMaySendAsConnection(input: {
  userEmail: string;
  connection: {
    email: string;
    provider: InboxProvider | string;
    status: InboxConnectionStatus | string;
    hasRefreshToken: boolean;
    grantedScopes: readonly string[];
  };
}): SendAuthorizationResult {
  const provider = String(input.connection.provider).toUpperCase();
  if (provider !== "OUTLOOK" && provider !== "GMAIL") {
    return {
      ok: false,
      statusCode: 409,
      code: "PROVIDER_UNSUPPORTED",
      message: "This mailbox provider does not support sending from ForgeOps.",
    };
  }

  if (!userOwnsMailbox(input.userEmail, input.connection.email)) {
    return {
      ok: false,
      statusCode: 403,
      code: "MAILBOX_IDENTITY_MISMATCH",
      message:
        "You can only send email from a mailbox that matches your signed-in ForgeOps account.",
    };
  }

  if (input.connection.status === "REQUIRES_REAUTH") {
    return {
      ok: false,
      statusCode: 409,
      code: "MAILBOX_REAUTH_REQUIRED",
      message:
        "This mailbox requires reauthorization before sending. Reconnect the mailbox in Workspace settings.",
    };
  }

  if (input.connection.status !== "ACTIVE") {
    return {
      ok: false,
      statusCode: 409,
      code: "CONNECTION_NOT_ACTIVE",
      message: "This mailbox connection is not active.",
    };
  }

  if (!input.connection.hasRefreshToken) {
    return {
      ok: false,
      statusCode: 409,
      code: "MAILBOX_AUTH_REQUIRED",
      message:
        "Mailbox authorization required before sending. Connect and authorize your mailbox in Workspace settings.",
    };
  }

  if (
    !connectionHasSendingScope({
      provider: input.connection.provider,
      grantedScopes: input.connection.grantedScopes,
    })
  ) {
    return {
      ok: false,
      statusCode: 409,
      code: "SEND_SCOPE_MISSING",
      message:
        provider === "OUTLOOK"
          ? "This Outlook mailbox is connected for reading but not sending. Reauthorize the mailbox to grant Mail.Send."
          : "This mailbox is missing send permission. Reauthorize the mailbox connection.",
    };
  }

  return { ok: true };
}

export function isConnectionSendableForUser(input: {
  userEmail: string;
  connection: {
    email: string;
    provider: InboxProvider | string;
    status: InboxConnectionStatus | string;
    hasRefreshToken: boolean;
    grantedScopes: readonly string[];
  };
}): boolean {
  return assertUserMaySendAsConnection(input).ok;
}
