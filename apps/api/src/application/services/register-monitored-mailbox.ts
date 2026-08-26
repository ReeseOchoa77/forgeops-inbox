import { normalizeEmail } from "@forgeops/shared";

export type RegisterMonitoredMailboxProvider = "GMAIL" | "OUTLOOK";

export interface RegisterMonitoredMailboxInput {
  workspaceId: string;
  email: string;
  provider: RegisterMonitoredMailboxProvider;
  displayName?: string;
}

export interface ExistingConnectionRef {
  id: string;
  workspaceId: string;
  provider: string;
  email: string;
  status: string;
  ingestionSource: string;
  nativeListeningEnabled: boolean;
}

/**
 * Decide create vs reuse for workspace-scoped monitored mailbox registration.
 * Never creates a duplicate for the same workspace+provider+email.
 */
export function resolveMonitoredMailboxRegistration(input: {
  requestedEmail: string;
  workspaceId: string;
  existingByProviderEmail: ExistingConnectionRef | null;
  approvedAccessActive: boolean;
}):
  | { ok: true; action: "create"; normalizedEmail: string }
  | { ok: true; action: "reuse"; normalizedEmail: string; connection: ExistingConnectionRef }
  | { ok: false; statusCode: 400 | 403 | 409; message: string } {
  const normalizedEmail = normalizeEmail(input.requestedEmail);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { ok: false, statusCode: 400, message: "Valid email is required" };
  }

  if (!input.approvedAccessActive) {
    return {
      ok: false,
      statusCode: 400,
      message:
        "Mailbox email must belong to an active workspace team member (Team Access).",
    };
  }

  const existing = input.existingByProviderEmail;
  if (!existing) {
    return { ok: true, action: "create", normalizedEmail };
  }

  if (existing.workspaceId !== input.workspaceId) {
    return {
      ok: false,
      statusCode: 409,
      message: `Mailbox ${normalizedEmail} is already registered in another workspace. Remove it there first.`,
    };
  }

  return {
    ok: true,
    action: "reuse",
    normalizedEmail,
    connection: existing,
  };
}

/** Safe defaults for newly registered monitored mailboxes (pre-OAuth). */
export const MONITORED_MAILBOX_CREATE_DEFAULTS = {
  ingestionSource: "N8N" as const,
  nativeListeningEnabled: false,
  status: "ACTIVE" as const,
};
