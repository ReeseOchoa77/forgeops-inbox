import { describe, expect, it, vi } from "vitest";
import {
  previewMailboxReclassify,
  sanitizeReclassifyFilters,
  MailboxReclassifyError,
  assertNativeMailbox,
} from "../application/services/mailbox-reclassify.js";

describe("sanitizeReclassifyFilters", () => {
  it("drops unknown subtype keys", () => {
    const out = sanitizeReclassifyFilters({
      businessTypeKeys: ["RFI_CLARIFICATION", "NOT_A_REAL_SUBTYPE"],
    });
    expect(out.businessTypeKeys).toEqual(["RFI_CLARIFICATION"]);
  });
});

describe("assertNativeMailbox", () => {
  it("rejects N8N mailboxes", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "c1",
          email: "a@b.com",
          ingestionSource: "N8N",
          status: "CONNECTED",
          provider: "outlook",
        }),
      },
    };
    await expect(
      assertNativeMailbox({
        prisma: prisma as never,
        workspaceId: "ws",
        inboxConnectionId: "c1",
      })
    ).rejects.toMatchObject({ code: "NOT_NATIVE" });
  });

  it("rejects missing mailbox (cross-workspace)", async () => {
    const prisma = {
      inboxConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      assertNativeMailbox({
        prisma: prisma as never,
        workspaceId: "ws-other",
        inboxConnectionId: "c1",
      })
    ).rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND" });
  });
});

describe("previewMailboxReclassify", () => {
  it("performs no writes", async () => {
    const create = vi.fn();
    const update = vi.fn();
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "c1",
          email: "ed@x.com",
          ingestionSource: "NATIVE",
          status: "CONNECTED",
          provider: "outlook",
        }),
      },
      emailMessage: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "m1",
            subject: "Hi",
            senderEmail: "a@b.com",
            receivedAt: new Date("2026-01-01T00:00:00Z"),
            sentAt: new Date("2026-01-01T00:00:00Z"),
            mailboxCategory: "BUSINESS",
            classificationStatus: "CLASSIFIED",
            priority: "HIGH",
            jobId: null,
            isRead: false,
            classifications: [{ businessTypeKey: "RFI_CLARIFICATION" }],
          },
        ]),
        groupBy: vi
          .fn()
          .mockResolvedValueOnce([
            { classificationStatus: "CLASSIFIED", _count: { _all: 2 } },
          ])
          .mockResolvedValueOnce([
            { mailboxCategory: "BUSINESS", _count: { _all: 2 } },
          ])
          .mockResolvedValueOnce([{ isRead: false, _count: { _all: 2 } }]),
        create,
        update,
        updateMany: vi.fn(),
      },
      task: {
        count: vi.fn().mockResolvedValue(3),
      },
      mailboxReclassifyRun: { create, update },
    };

    const result = await previewMailboxReclassify({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "c1",
      filters: { category: "BUSINESS", readStatus: "UNREAD" },
      taskMode: "REMOVE_ONLY",
    });

    expect(result.totalMatched).toBe(2);
    expect(result.classifierTasksToRemove).toBe(3);
    expect(result.taskMode).toBe("REMOVE_ONLY");
    expect(result.sample[0]?.businessTypeKey).toBe("RFI_CLARIFICATION");
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects oversized messageIds selection", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "c1",
          email: "ed@x.com",
          ingestionSource: "NATIVE",
          status: "CONNECTED",
          provider: "outlook",
        }),
      },
    };
    const ids = Array.from({ length: 501 }, (_, i) => `m${i}`);
    await expect(
      previewMailboxReclassify({
        prisma: prisma as never,
        workspaceId: "ws",
        inboxConnectionId: "c1",
        filters: {},
        messageIds: ids,
      })
    ).rejects.toBeInstanceOf(MailboxReclassifyError);
  });
});
