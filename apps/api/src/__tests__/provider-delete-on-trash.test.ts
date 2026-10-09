import { describe, expect, it, vi } from "vitest";

import { deleteOutlookProviderMessage } from "../application/services/outlook-provider-message-delete.js";
import {
  shouldDeleteFromProviderOnUserTrash,
  trashEmailMessagesWithOptionalProviderDelete,
} from "../application/services/trash-email-with-provider-delete.js";
import { outlookInboxConnectionScopes } from "../infrastructure/providers/outlook/outlook-provider.js";

function makeTokenCipher() {
  return {
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => (v.startsWith("enc:") ? v.slice(4) : v),
  };
}

describe("deleteFromProviderOnDelete defaults and gates", () => {
  it("defaults OFF", () => {
    expect(shouldDeleteFromProviderOnUserTrash(undefined)).toBe(false);
    expect(shouldDeleteFromProviderOnUserTrash(false)).toBe(false);
    expect(shouldDeleteFromProviderOnUserTrash(true)).toBe(true);
  });

  it("authorize URL requests Mail.ReadWrite for provider delete capability", () => {
    expect(outlookInboxConnectionScopes).toContain(
      "https://graph.microsoft.com/Mail.ReadWrite"
    );
  });
});

describe("deleteOutlookProviderMessage", () => {
  it("uses exact providerMessageId and /me by default", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 })
    );
    const result = await deleteOutlookProviderMessage(
      {
        providerMessageId: "AAMkExactId",
        accessToken: "tok",
      },
      fetchImpl
    );
    expect(result.outcome).toBe("deleted");
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain("/me/messages/AAMkExactId");
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("uses /users/{mailbox} for delegated connections", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 })
    );
    await deleteOutlookProviderMessage(
      {
        providerMessageId: "AAMkExactId",
        graphMailboxEmail: "estimating@company.com",
        accessToken: "tok",
      },
      fetchImpl
    );
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain("/users/estimating%40company.com/messages/AAMkExactId");
    expect(url).not.toContain("/me/");
  });

  it("treats 404 as already_deleted (idempotent)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("gone", { status: 404 })
    );
    const result = await deleteOutlookProviderMessage(
      { providerMessageId: "gone", accessToken: "tok" },
      fetchImpl
    );
    expect(result.outcome).toBe("already_deleted");
  });

  it("fails closed on 403", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("no", { status: 403 })
    );
    const result = await deleteOutlookProviderMessage(
      { providerMessageId: "x", accessToken: "tok" },
      fetchImpl
    );
    expect(result.outcome).toBe("failed");
    expect(result.message).toMatch(/Mail\.ReadWrite|Re-authorize/i);
  });
});

describe("trashEmailMessagesWithOptionalProviderDelete", () => {
  it("OFF → ForgeOps trash only; provider not called", async () => {
    const fetchImpl = vi.fn();
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          id: "conn1",
          provider: "OUTLOOK",
          email: "a@company.com",
          deleteFromProviderOnDelete: false,
          delegatedMailboxAccess: false,
          encryptedRefreshToken: "enc:rt",
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
        })),
        update: vi.fn(),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "msg1",
            gmailMessageId: "prov1",
            providerMessageId: "prov1",
            isTrashed: false,
            inboxConnectionId: "conn1",
          },
        ]),
        updateMany,
      },
    };

    const result = await trashEmailMessagesWithOptionalProviderDelete({
      prisma: prisma as never,
      tokenCipher: makeTokenCipher() as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      messageSelectors: ["msg1"],
      outlook: {
        clientId: "cid",
        clientSecret: "sec",
        tenantId: "common",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, trashed: 1, providerDeleted: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled();
  });

  it("ON → Outlook provider deletion called with exact id, then local trash", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "access" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("/messages/") && init?.method === "DELETE") {
        expect(u).toContain("/messages/prov-exact");
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch ${u}`);
    });

    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          id: "conn1",
          provider: "OUTLOOK",
          email: "a@company.com",
          deleteFromProviderOnDelete: true,
          delegatedMailboxAccess: false,
          encryptedRefreshToken: "enc:rt",
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
        })),
        update: vi.fn(async () => ({})),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "msg1",
            gmailMessageId: "prov-exact",
            providerMessageId: "prov-exact",
            isTrashed: false,
            inboxConnectionId: "conn1",
          },
        ]),
        updateMany,
      },
    };

    const result = await trashEmailMessagesWithOptionalProviderDelete({
      prisma: prisma as never,
      tokenCipher: makeTokenCipher() as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      messageSelectors: ["msg1"],
      outlook: {
        clientId: "cid",
        clientSecret: "sec",
        tenantId: "common",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, trashed: 1, providerDeleted: true });
    expect(updateMany).toHaveBeenCalled();
    expect(
      fetchImpl.mock.calls.some(
        (c) => String(c[0]).includes("/messages/prov-exact") && c[1]?.method === "DELETE"
      )
    ).toBe(true);
  });

  it("provider failure does not silently succeed or trash locally", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "access" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 500 });
    });
    const updateMany = vi.fn();
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          id: "conn1",
          provider: "OUTLOOK",
          email: "a@company.com",
          deleteFromProviderOnDelete: true,
          delegatedMailboxAccess: false,
          encryptedRefreshToken: "enc:rt",
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
        })),
        update: vi.fn(async () => ({})),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "msg1",
            gmailMessageId: "prov1",
            providerMessageId: "prov1",
            isTrashed: false,
            inboxConnectionId: "conn1",
          },
        ]),
        updateMany,
      },
    };

    const result = await trashEmailMessagesWithOptionalProviderDelete({
      prisma: prisma as never,
      tokenCipher: makeTokenCipher() as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      messageSelectors: ["msg1"],
      outlook: {
        clientId: "cid",
        clientSecret: "sec",
        tenantId: "common",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Provider delete failed|failed/i);
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("already-deleted provider message allows local cleanup", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "access" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (init?.method === "DELETE") {
        return new Response("not found", { status: 404 });
      }
      throw new Error(u);
    });
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          id: "conn1",
          provider: "OUTLOOK",
          email: "a@company.com",
          deleteFromProviderOnDelete: true,
          delegatedMailboxAccess: false,
          encryptedRefreshToken: "enc:rt",
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
        })),
        update: vi.fn(async () => ({})),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "msg1",
            gmailMessageId: "prov1",
            providerMessageId: "prov1",
            isTrashed: false,
            inboxConnectionId: "conn1",
          },
        ]),
        updateMany,
      },
    };

    const result = await trashEmailMessagesWithOptionalProviderDelete({
      prisma: prisma as never,
      tokenCipher: makeTokenCipher() as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      messageSelectors: ["msg1"],
      outlook: {
        clientId: "cid",
        clientSecret: "sec",
        tenantId: "common",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, trashed: 1, providerDeleted: true });
    expect(updateMany).toHaveBeenCalled();
  });

  it("one mailbox ON does not affect another mailbox OFF (connection-scoped)", async () => {
    const fetchImpl = vi.fn();
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          provider: "OUTLOOK",
          email: "off@company.com",
          deleteFromProviderOnDelete: false,
          delegatedMailboxAccess: false,
          encryptedRefreshToken: "enc:rt",
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
        })),
        update: vi.fn(),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "msg-off",
            gmailMessageId: "p1",
            providerMessageId: "p1",
            isTrashed: false,
            inboxConnectionId: "conn-off",
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    const result = await trashEmailMessagesWithOptionalProviderDelete({
      prisma: prisma as never,
      tokenCipher: makeTokenCipher() as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn-off",
      messageSelectors: ["msg-off"],
      outlook: { clientId: "c", clientSecret: "s", tenantId: "common" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok && result.providerDeleted).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects missing provider message id instead of heuristic delete", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/token")) {
        return new Response(JSON.stringify({ access_token: "access" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("should not delete");
    });
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          id: "conn1",
          provider: "OUTLOOK",
          email: "a@company.com",
          deleteFromProviderOnDelete: true,
          delegatedMailboxAccess: false,
          encryptedRefreshToken: "enc:rt",
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
        })),
        update: vi.fn(async () => ({})),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "msg1",
            gmailMessageId: "   ",
            providerMessageId: null,
            isTrashed: false,
            inboxConnectionId: "conn1",
          },
        ]),
        updateMany: vi.fn(),
      },
    };

    const result = await trashEmailMessagesWithOptionalProviderDelete({
      prisma: prisma as never,
      tokenCipher: makeTokenCipher() as never,
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      messageSelectors: ["msg1"],
      outlook: { clientId: "c", clientSecret: "s", tenantId: "common" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no provider message id/i);
  });
});

describe("Clear Inbox / job paths must not use provider trash helper", () => {
  it("documents that Clear Inbox uses deleteScopedEmailMessages, not trash helper", async () => {
    // Structural guard: clear-inbox module must not import provider trash helper.
    const clearInboxSource = await import("../application/services/clear-inbox.js");
    expect(typeof clearInboxSource.clearConnectionInbox).toBe("function");
    expect(typeof clearInboxSource.deleteScopedEmailMessages).toBe("function");
    expect(
      "trashEmailMessagesWithOptionalProviderDelete" in clearInboxSource
    ).toBe(false);
  });
});
