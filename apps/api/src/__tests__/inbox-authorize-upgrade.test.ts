import { describe, expect, it, vi } from "vitest";
import { normalizeEmail } from "@forgeops/shared";

import { enqueueAttachmentIngestIfEligible } from "../application/services/enqueue-attachment-ingest.js";
import {
  assertTargetedMailboxEmailMatch,
  buildAuthorizationFields,
  validateAuthorizeExistingTarget,
} from "../application/services/inbox-authorization-status.js";

/**
 * Simulates the Phase B authorize-existing callback upgrade against an
 * in-memory store — mirrors route invariants without spinning Fastify.
 */
function createUpgradeStore(seed: {
  workspaceId: string;
  connection: {
    id: string;
    email: string;
    provider: "OUTLOOK" | "GMAIL";
    status: string;
    ingestionSource: string;
    nativeListeningEnabled?: boolean;
    encryptedRefreshToken: string | null;
    encryptedAccessToken: string | null;
  };
  mailbox: {
    id: string;
    normalizedEmail: string;
    provider: "OUTLOOK" | "GMAIL";
    inboxConnectionId: string | null;
  };
}) {
  const connections = new Map([
    [
      seed.connection.id,
      {
        nativeListeningEnabled: false,
        ...seed.connection,
      },
    ],
  ]);
  const mailboxes = new Map([[seed.mailbox.id, { ...seed.mailbox, workspaceId: seed.workspaceId }]]);
  let createCount = 0;

  return {
    connections,
    mailboxes,
    get createCount() {
      return createCount;
    },
    async loadTargetedConnection(connectionId: string, workspaceId: string) {
      const conn = connections.get(connectionId);
      if (!conn || workspaceId !== seed.workspaceId) return null;
      // Cross-workspace: only match seeded workspace
      return { ...conn, workspaceId };
    },
    async applySuccessfulUpgrade(input: {
      workspaceId: string;
      connectionId: string;
      microsoftEmail: string;
      encryptedRefreshToken: string;
      encryptedAccessToken: string;
    }) {
      const target = await this.loadTargetedConnection(
        input.connectionId,
        input.workspaceId
      );
      if (!target) {
        throw new Error("Authorization target inbox connection no longer exists");
      }

      const mismatch = assertTargetedMailboxEmailMatch({
        expectedEmail: target.email,
        microsoftEmail: input.microsoftEmail,
      });
      if (mismatch) {
        throw new Error(mismatch);
      }

      // Never create on targeted upgrade; preserve processing config fields.
      const updated = {
        ...target,
        email: normalizeEmail(input.microsoftEmail),
        encryptedRefreshToken: input.encryptedRefreshToken,
        encryptedAccessToken: input.encryptedAccessToken,
        status: "ACTIVE",
        // ingestionSource + nativeListeningEnabled preserved (not in update data)
      };
      connections.set(target.id, updated);

      const normalized = normalizeEmail(updated.email);
      for (const [id, mb] of mailboxes) {
        if (
          mb.workspaceId === input.workspaceId &&
          mb.provider === updated.provider &&
          mb.normalizedEmail === normalized
        ) {
          mailboxes.set(id, { ...mb, inboxConnectionId: updated.id });
        }
      }

      return updated;
    },
    async rejectWrongMailbox(input: {
      workspaceId: string;
      connectionId: string;
      microsoftEmail: string;
    }) {
      const before = structuredClone({
        connections: [...connections.entries()],
        mailboxes: [...mailboxes.entries()],
        createCount,
      });
      try {
        await this.applySuccessfulUpgrade({
          ...input,
          encryptedRefreshToken: "should-not-store",
          encryptedAccessToken: "should-not-store",
        });
        throw new Error("expected mismatch rejection");
      } catch (error) {
        // Ensure no side effects
        expect([...connections.entries()]).toEqual(before.connections);
        expect([...mailboxes.entries()]).toEqual(before.mailboxes);
        expect(createCount).toBe(before.createCount);
        throw error;
      }
    },
    // unused create path detector
    createConnection() {
      createCount += 1;
    },
  };
}

describe("authorize-existing upgrade flow", () => {
  const workspaceId = "ws_estimate";
  const connectionId = "conn_n8n_outlook";
  const mailboxEmail = "estimating@company.com";

  it("rejects authorizing a connection from another workspace", async () => {
    const store = createUpgradeStore({
      workspaceId,
      connection: {
        id: connectionId,
        email: mailboxEmail,
        provider: "OUTLOOK",
        status: "ACTIVE",
        ingestionSource: "N8N",
        encryptedRefreshToken: null,
        encryptedAccessToken: null,
      },
      mailbox: {
        id: "mb_1",
        normalizedEmail: mailboxEmail,
        provider: "OUTLOOK",
        inboxConnectionId: connectionId,
      },
    });

    const found = await store.loadTargetedConnection(connectionId, "ws_other");
    expect(found).toBeNull();
  });

  it("rejects non-Outlook provider at authorize start", () => {
    expect(
      validateAuthorizeExistingTarget({ provider: "GMAIL", status: "ACTIVE" }).ok
    ).toBe(false);
  });

  it("wrong Microsoft mailbox rejects without linking tokens or creating B", async () => {
    const store = createUpgradeStore({
      workspaceId,
      connection: {
        id: connectionId,
        email: mailboxEmail,
        provider: "OUTLOOK",
        status: "ACTIVE",
        ingestionSource: "N8N",
        encryptedRefreshToken: null,
        encryptedAccessToken: null,
      },
      mailbox: {
        id: "mb_1",
        normalizedEmail: mailboxEmail,
        provider: "OUTLOOK",
        inboxConnectionId: connectionId,
      },
    });

    await expect(
      store.rejectWrongMailbox({
        workspaceId,
        connectionId,
        microsoftEmail: "reese@company.com",
      })
    ).rejects.toThrow(/different Microsoft mailbox/i);

    const conn = store.connections.get(connectionId)!;
    expect(conn.encryptedRefreshToken).toBeNull();
    expect(conn.ingestionSource).toBe("N8N");
    expect(store.createCount).toBe(0);
    // No accidental connection for reese@
    expect(
      [...store.connections.values()].some((c) => c.email.includes("reese"))
    ).toBe(false);
  });

  it("successful upgrade reuses same InboxConnection and links WorkspaceMailbox", async () => {
    const store = createUpgradeStore({
      workspaceId,
      connection: {
        id: connectionId,
        email: mailboxEmail,
        provider: "OUTLOOK",
        status: "ACTIVE",
        ingestionSource: "N8N",
        encryptedRefreshToken: null,
        encryptedAccessToken: null,
      },
      mailbox: {
        id: "mb_1",
        normalizedEmail: mailboxEmail,
        provider: "OUTLOOK",
        inboxConnectionId: null,
      },
    });

    expect(
      buildAuthorizationFields({
        provider: "OUTLOOK",
        status: "ACTIVE",
        hasRefreshToken: false,
      }).authorizationStatus
    ).toBe("REQUIRED");

    const upgraded = await store.applySuccessfulUpgrade({
      workspaceId,
      connectionId,
      microsoftEmail: "Estimating@Company.COM",
      encryptedRefreshToken: "enc-refresh",
      encryptedAccessToken: "enc-access",
    });

    expect(upgraded.id).toBe(connectionId);
    expect(upgraded.encryptedRefreshToken).toBe("enc-refresh");
    expect(upgraded.ingestionSource).toBe("N8N");
    expect(store.connections.size).toBe(1);
    expect(store.mailboxes.get("mb_1")?.inboxConnectionId).toBe(connectionId);

    expect(
      buildAuthorizationFields({
        provider: "OUTLOOK",
        status: "ACTIVE",
        hasRefreshToken: Boolean(upgraded.encryptedRefreshToken),
      })
    ).toMatchObject({
      authorizationStatus: "CONNECTED",
      capabilities: { attachmentIngestion: true },
    });
  });

  it("authorize twice is idempotent (no duplicate connection/mailbox)", async () => {
    const store = createUpgradeStore({
      workspaceId,
      connection: {
        id: connectionId,
        email: mailboxEmail,
        provider: "OUTLOOK",
        status: "ACTIVE",
        ingestionSource: "N8N",
        encryptedRefreshToken: null,
        encryptedAccessToken: null,
      },
      mailbox: {
        id: "mb_1",
        normalizedEmail: mailboxEmail,
        provider: "OUTLOOK",
        inboxConnectionId: connectionId,
      },
    });

    await store.applySuccessfulUpgrade({
      workspaceId,
      connectionId,
      microsoftEmail: mailboxEmail,
      encryptedRefreshToken: "enc-1",
      encryptedAccessToken: "enc-a1",
    });
    await store.applySuccessfulUpgrade({
      workspaceId,
      connectionId,
      microsoftEmail: mailboxEmail,
      encryptedRefreshToken: "enc-2",
      encryptedAccessToken: "enc-a2",
    });

    expect(store.connections.size).toBe(1);
    expect(store.mailboxes.size).toBe(1);
    expect(store.connections.get(connectionId)?.encryptedRefreshToken).toBe("enc-2");
    expect(store.mailboxes.get("mb_1")?.inboxConnectionId).toBe(connectionId);
  });

  it("after upgrade, future n8n email can enqueue ATTACHMENT_INGEST", async () => {
    const store = createUpgradeStore({
      workspaceId,
      connection: {
        id: connectionId,
        email: mailboxEmail,
        provider: "OUTLOOK",
        status: "ACTIVE",
        ingestionSource: "N8N",
        encryptedRefreshToken: null,
        encryptedAccessToken: null,
      },
      mailbox: {
        id: "mb_1",
        normalizedEmail: mailboxEmail,
        provider: "OUTLOOK",
        inboxConnectionId: connectionId,
      },
    });

    // Before: tokenless → no enqueue
    const prismaBefore = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          provider: "OUTLOOK",
          encryptedRefreshToken: store.connections.get(connectionId)!.encryptedRefreshToken,
        })),
      },
    };
    const queue = { add: vi.fn(async () => ({ id: "job1" })) };

    const before = await enqueueAttachmentIngestIfEligible({
      prisma: prismaBefore as never,
      queue: queue as never,
      workspaceId,
      inboxConnectionId: connectionId,
      emailMessageId: "msg_before",
      hasAttachments: true,
      bodyHtml: null,
    });
    expect(before).toEqual({ enqueued: false, reason: "no_token" });

    await store.applySuccessfulUpgrade({
      workspaceId,
      connectionId,
      microsoftEmail: mailboxEmail,
      encryptedRefreshToken: "enc-refresh-live",
      encryptedAccessToken: "enc-access-live",
    });

    expect(store.mailboxes.get("mb_1")?.inboxConnectionId).toBe(connectionId);

    // New n8n email references SAME InboxConnection
    const emailMessage = {
      id: "msg_after",
      inboxConnectionId: connectionId,
      workspaceId,
    };

    const prismaAfter = {
      inboxConnection: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
          const conn = store.connections.get(where.id);
          if (!conn || where.workspaceId !== workspaceId) return null;
          return {
            provider: conn.provider,
            encryptedRefreshToken: conn.encryptedRefreshToken,
          };
        }),
      },
    };

    const after = await enqueueAttachmentIngestIfEligible({
      prisma: prismaAfter as never,
      queue: queue as never,
      workspaceId: emailMessage.workspaceId,
      inboxConnectionId: emailMessage.inboxConnectionId,
      emailMessageId: emailMessage.id,
      providerMessageId: "AAMk-after",
      hasAttachments: true,
      bodyHtml: `<img src="cid:logo@01">`,
    });

    expect(after.enqueued).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      "attachment-ingest",
      expect.objectContaining({
        workspaceId,
        inboxConnectionId: connectionId,
        emailMessageId: "msg_after",
      }),
      expect.objectContaining({ jobId: "attachment-ingest-msg_after" })
    );
  });

  it("DISCONNECTED mailbox can start authorize and OAuth reuses same connection", async () => {
    expect(
      validateAuthorizeExistingTarget({
        provider: "OUTLOOK",
        status: "DISCONNECTED",
      })
    ).toEqual({ ok: true });

    const store = createUpgradeStore({
      workspaceId,
      connection: {
        id: connectionId,
        email: mailboxEmail,
        provider: "OUTLOOK",
        status: "DISCONNECTED",
        ingestionSource: "NATIVE",
        nativeListeningEnabled: false,
        encryptedRefreshToken: null,
        encryptedAccessToken: null,
      },
      mailbox: {
        id: "mb_1",
        normalizedEmail: mailboxEmail,
        provider: "OUTLOOK",
        inboxConnectionId: connectionId,
      },
    });

    const upgraded = await store.applySuccessfulUpgrade({
      workspaceId,
      connectionId,
      microsoftEmail: mailboxEmail,
      encryptedRefreshToken: "enc-refresh",
      encryptedAccessToken: "enc-access",
    });

    expect(upgraded.id).toBe(connectionId);
    expect(upgraded.status).toBe("ACTIVE");
    expect(upgraded.ingestionSource).toBe("NATIVE");
    expect(upgraded.nativeListeningEnabled).toBe(false);
    expect(store.connections.size).toBe(1);
    expect(store.createCount).toBe(0);
  });

  it("REQUIRES_REAUTH must use reconnect (authorize start rejected)", () => {
    const result = validateAuthorizeExistingTarget({
      provider: "OUTLOOK",
      status: "REQUIRES_REAUTH",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(409);
    }
  });

  it("successful reconnect of REQUIRES_REAUTH preserves NATIVE listening settings", async () => {
    const store = createUpgradeStore({
      workspaceId,
      connection: {
        id: connectionId,
        email: mailboxEmail,
        provider: "OUTLOOK",
        status: "REQUIRES_REAUTH",
        ingestionSource: "NATIVE",
        nativeListeningEnabled: true,
        encryptedRefreshToken: "stale-token",
        encryptedAccessToken: "stale-access",
      },
      mailbox: {
        id: "mb_1",
        normalizedEmail: mailboxEmail,
        provider: "OUTLOOK",
        inboxConnectionId: connectionId,
      },
    });

    const upgraded = await store.applySuccessfulUpgrade({
      workspaceId,
      connectionId,
      microsoftEmail: mailboxEmail,
      encryptedRefreshToken: "fresh-refresh",
      encryptedAccessToken: "fresh-access",
    });

    expect(upgraded.id).toBe(connectionId);
    expect(upgraded.status).toBe("ACTIVE");
    expect(upgraded.ingestionSource).toBe("NATIVE");
    expect(upgraded.nativeListeningEnabled).toBe(true);
    expect(store.connections.size).toBe(1);
  });

  it("ACTIVE remains supported for authorize-existing", () => {
    expect(
      validateAuthorizeExistingTarget({ provider: "OUTLOOK", status: "ACTIVE" })
    ).toEqual({ ok: true });
  });
});
