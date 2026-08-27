import type { InboxConnectionStatus, InboxProvider } from "@prisma/client";

export type SendDenialCode =
  | "SEND_ROLE_DENIED"
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

/**
 * Authorize outbound send from a monitored mailbox.
 *
 * Requires workspace send role (not VIEWER) + OAuth-ready connection with Mail.Send.
 * Does NOT require ForgeOps login email === mailbox email — admins/members may
 * send as any authorized monitored mailbox in the workspace.
 */
export function assertUserMaySendAsConnection(input: {
  /** Workspace membership role; VIEWER cannot send. */
  workspaceRole?: string | null;
  connection: {
    email: string;
    provider: InboxProvider | string;
    status: InboxConnectionStatus | string;
    hasRefreshToken: boolean;
    grantedScopes: readonly string[];
  };
}): SendAuthorizationResult {
  const role = String(input.workspaceRole ?? "").toUpperCase();
  if (role === "VIEWER") {
    return {
      ok: false,
      statusCode: 403,
      code: "SEND_ROLE_DENIED",
      message: "Viewers cannot send email. Ask an admin for Member access or higher.",
    };
  }

  const provider = String(input.connection.provider).toUpperCase();
  if (provider !== "OUTLOOK" && provider !== "GMAIL") {
    return {
      ok: false,
      statusCode: 409,
      code: "PROVIDER_UNSUPPORTED",
      message: "This mailbox provider does not support sending from ForgeOps.",
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
  workspaceRole?: string | null;
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
