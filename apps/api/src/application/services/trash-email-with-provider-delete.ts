import type { PrismaClient } from "@prisma/client";
import type { TokenCipher } from "@forgeops/shared";

import {
  deleteOutlookProviderMessage,
  refreshOutlookAccessToken,
} from "./outlook-provider-message-delete.js";

export type TrashWithProviderResult =
  | { ok: true; trashed: number; providerDeleted: boolean }
  | { ok: false; statusCode: number; message: string };

function resolveProviderMessageId(message: {
  providerMessageId: string | null;
  gmailMessageId: string;
}): string | null {
  const fromProvider = message.providerMessageId?.trim();
  if (fromProvider) return fromProvider;
  const fromGmailField = message.gmailMessageId?.trim();
  return fromGmailField || null;
}

/**
 * Explicit Inbox UI trash. When connection.deleteFromProviderOnDelete:
 * provider delete first (idempotent 404), then local isTrashed=true.
 * Clear Inbox / job delete / admin cleanup must NOT call this.
 */
export async function trashEmailMessagesWithOptionalProviderDelete(input: {
  prisma: PrismaClient;
  tokenCipher: TokenCipher;
  workspaceId: string;
  inboxConnectionId: string;
  /** ForgeOps EmailMessage ids and/or provider message ids */
  messageSelectors: string[];
  outlook: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    tenantId: string;
  };
  fetchImpl?: typeof fetch;
  actorUserId?: string;
}): Promise<TrashWithProviderResult> {
  const selectors = [...new Set(input.messageSelectors.map((s) => s.trim()).filter(Boolean))];
  if (selectors.length === 0) {
    return { ok: true, trashed: 0, providerDeleted: false };
  }

  const connection = await input.prisma.inboxConnection.findFirst({
    where: {
      id: input.inboxConnectionId,
      workspaceId: input.workspaceId,
    },
    select: {
      id: true,
      provider: true,
      email: true,
      deleteFromProviderOnDelete: true,
      delegatedMailboxAccess: true,
      encryptedRefreshToken: true,
      encryptedAccessToken: true,
      accessTokenExpiresAt: true,
    },
  });

  if (!connection) {
    return { ok: false, statusCode: 404, message: "Inbox connection not found" };
  }

  const messages = await input.prisma.emailMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      OR: [{ id: { in: selectors } }, { gmailMessageId: { in: selectors } }],
    },
    select: {
      id: true,
      gmailMessageId: true,
      providerMessageId: true,
      isTrashed: true,
      inboxConnectionId: true,
    },
  });

  if (messages.length === 0) {
    return { ok: true, trashed: 0, providerDeleted: false };
  }

  // Defense: never operate across a different connection than requested.
  if (messages.some((m) => m.inboxConnectionId !== input.inboxConnectionId)) {
    return {
      ok: false,
      statusCode: 400,
      message: "Message does not belong to the requested mailbox connection",
    };
  }

  const toTrash = messages.filter((m) => !m.isTrashed);

  if (!connection.deleteFromProviderOnDelete) {
    if (toTrash.length === 0) {
      return { ok: true, trashed: 0, providerDeleted: false };
    }
    const result = await input.prisma.emailMessage.updateMany({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        id: { in: toTrash.map((m) => m.id) },
      },
      data: { isTrashed: true },
    });
    return { ok: true, trashed: result.count, providerDeleted: false };
  }

  if (connection.provider !== "OUTLOOK") {
    return {
      ok: false,
      statusCode: 400,
      message:
        "Delete from connected mailbox is only supported for Outlook. " +
        "Turn the setting off or use an Outlook mailbox.",
    };
  }

  if (!connection.encryptedRefreshToken) {
    return {
      ok: false,
      statusCode: 400,
      message:
        "Mailbox is not OAuth-connected. Authorize Outlook before enabling provider deletion.",
    };
  }

  if (!input.outlook.clientId || !input.outlook.clientSecret) {
    return {
      ok: false,
      statusCode: 503,
      message: "Outlook OAuth is not configured on this API",
    };
  }

  const refreshToken = input.tokenCipher.decrypt(connection.encryptedRefreshToken);
  const tokenResult = await refreshOutlookAccessToken({
    clientId: input.outlook.clientId,
    clientSecret: input.outlook.clientSecret,
    tenantId: input.outlook.tenantId,
    refreshToken,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });

  if (!tokenResult.ok) {
    return { ok: false, statusCode: 502, message: tokenResult.message };
  }

  if (tokenResult.refreshedRefreshToken) {
    await input.prisma.inboxConnection.update({
      where: { id: connection.id },
      data: {
        encryptedRefreshToken: input.tokenCipher.encrypt(
          tokenResult.refreshedRefreshToken
        ),
        encryptedAccessToken: input.tokenCipher.encrypt(tokenResult.accessToken),
      },
    });
  } else {
    await input.prisma.inboxConnection.update({
      where: { id: connection.id },
      data: {
        encryptedAccessToken: input.tokenCipher.encrypt(tokenResult.accessToken),
      },
    });
  }

  const graphMailboxEmail = connection.delegatedMailboxAccess
    ? connection.email
    : null;

  const providerOkIds: string[] = [];
  for (const message of toTrash) {
    const providerMessageId = resolveProviderMessageId(message);
    if (!providerMessageId) {
      return {
        ok: false,
        statusCode: 409,
        message:
          "Cannot delete from provider: this email has no provider message id. " +
          "Local trash was not applied.",
      };
    }

    const deleted = await deleteOutlookProviderMessage(
      {
        providerMessageId,
        graphMailboxEmail,
        accessToken: tokenResult.accessToken,
      },
      input.fetchImpl
    );

    if (deleted.outcome === "failed" || deleted.outcome === "unsupported") {
      return {
        ok: false,
        statusCode: deleted.status && deleted.status >= 400 ? deleted.status : 502,
        message:
          deleted.message ??
          "Failed to delete the message from the connected mailbox. Local trash was not applied.",
      };
    }

    providerOkIds.push(message.id);
  }

  // Also mark already-trashed messages referenced by selector as no-op locally.
  if (providerOkIds.length === 0) {
    return { ok: true, trashed: 0, providerDeleted: true };
  }

  const result = await input.prisma.emailMessage.updateMany({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      id: { in: providerOkIds },
    },
    data: { isTrashed: true },
  });

  return {
    ok: true,
    trashed: result.count,
    providerDeleted: true,
  };
}

/** Pure gate used by Clear Inbox / job delete callers — must stay false for those paths. */
export function shouldDeleteFromProviderOnUserTrash(
  deleteFromProviderOnDelete: boolean | null | undefined
): boolean {
  return Boolean(deleteFromProviderOnDelete);
}
