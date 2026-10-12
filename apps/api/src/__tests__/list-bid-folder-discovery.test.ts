import { describe, expect, it, vi } from "vitest";
import { listBidFolderDiscoveryEmails } from "../application/services/list-bid-folder-discovery.js";

describe("listBidFolderDiscoveryEmails", () => {
  it("sorts newest-first by email date before pagination", async () => {
    const orderByCaptures: unknown[] = [];
    const prisma = {
      bidFolderDiscoveryEmail: {
        count: vi.fn(async () => 2),
        findMany: vi.fn(async (args: { orderBy: unknown; skip: number; take: number }) => {
          orderByCaptures.push(args.orderBy);
          expect(args.skip).toBe(0);
          expect(args.take).toBe(50);
          return [
            {
              id: "d1",
              role: "BID_INVITE",
              lastSeenAt: new Date(),
              firstDiscoveredAt: new Date(),
              emailMessage: {
                id: "e1",
                subject: "ITB",
                senderName: "GC",
                senderEmail: "gc@example.com",
                sentAt: new Date("2026-10-01T00:00:00.000Z"),
                receivedAt: new Date("2026-10-01T00:00:00.000Z"),
                hasAttachments: false,
                attachmentMetadata: [],
                jobId: null,
              },
            },
          ];
        }),
      },
    };

    const res = await listBidFolderDiscoveryEmails({
      prisma: prisma as never,
      workspaceId: "ws",
      connectionId: "conn",
      role: "BID_INVITE",
      sort: "newest",
      page: 1,
      pageSize: 50,
    });

    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(1);
    expect(orderByCaptures[0]).toEqual([
      { emailMessage: { receivedAt: "desc" } },
      { emailMessage: { sentAt: "desc" } },
      { id: "desc" },
    ]);
  });

  it("scopes search to the selected role only", async () => {
    const prisma = {
      bidFolderDiscoveryEmail: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async (args: { where: { role: string } }) => {
          expect(args.where.role).toBe("QUOTE");
          return [];
        }),
      },
    };
    await listBidFolderDiscoveryEmails({
      prisma: prisma as never,
      workspaceId: "ws",
      connectionId: "conn",
      role: "QUOTE",
      search: "Falcon",
    });
    expect(prisma.bidFolderDiscoveryEmail.findMany).toHaveBeenCalled();
  });

  it("page 2 uses skip offset (server pagination for infinite scroll)", async () => {
    const prisma = {
      bidFolderDiscoveryEmail: {
        count: vi.fn(async () => 127),
        findMany: vi.fn(async (args: { skip: number; take: number }) => {
          expect(args.skip).toBe(50);
          expect(args.take).toBe(50);
          return [];
        }),
      },
    };
    const res = await listBidFolderDiscoveryEmails({
      prisma: prisma as never,
      workspaceId: "ws",
      connectionId: "conn",
      role: "BID_INVITE",
      page: 2,
      pageSize: 50,
    });
    expect(res.total).toBe(127);
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(50);
  });
});
