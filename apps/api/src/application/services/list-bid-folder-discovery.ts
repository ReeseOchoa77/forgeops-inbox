import type { Prisma, PrismaClient } from "@prisma/client";

export type BidFolderDiscoveryListRole = "BID_INVITE" | "QUOTE";
export type BidFolderDiscoverySort = "newest" | "oldest";

export async function listBidFolderDiscoveryEmails(input: {
  prisma: PrismaClient;
  workspaceId: string;
  connectionId: string;
  role: BidFolderDiscoveryListRole;
  sort?: BidFolderDiscoverySort;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  total: number;
  page: number;
  pageSize: number;
  items: Array<{
    discoveryId: string;
    role: BidFolderDiscoveryListRole;
    lastSeenAt: Date;
    firstDiscoveredAt: Date;
    email: {
      id: string;
      subject: string | null;
      senderName: string | null;
      senderEmail: string;
      sentAt: Date;
      receivedAt: Date | null;
      hasAttachments: boolean;
      attachmentCount: number;
      jobId: string | null;
    };
  }>;
}> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const sort: BidFolderDiscoverySort = input.sort === "oldest" ? "oldest" : "newest";
  const search = input.search?.trim() ?? "";

  const where: Prisma.BidFolderDiscoveryEmailWhereInput = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.connectionId,
    role: input.role,
    ...(search
      ? {
          emailMessage: {
            OR: [
              { subject: { contains: search, mode: "insensitive" } },
              { senderEmail: { contains: search, mode: "insensitive" } },
              { senderName: { contains: search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const total = await input.prisma.bidFolderDiscoveryEmail.count({ where });

  // Sort by canonical email date server-side BEFORE pagination.
  const rows = await input.prisma.bidFolderDiscoveryEmail.findMany({
    where,
    include: {
      emailMessage: {
        select: {
          id: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          sentAt: true,
          receivedAt: true,
          hasAttachments: true,
          attachmentMetadata: true,
          jobId: true,
        },
      },
    },
    orderBy:
      sort === "oldest"
        ? [
            { emailMessage: { receivedAt: "asc" } },
            { emailMessage: { sentAt: "asc" } },
            { id: "asc" },
          ]
        : [
            { emailMessage: { receivedAt: "desc" } },
            { emailMessage: { sentAt: "desc" } },
            { id: "desc" },
          ],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    total,
    page,
    pageSize,
    items: rows.map((r) => {
      const meta = r.emailMessage.attachmentMetadata;
      const attachmentCount = Array.isArray(meta) ? meta.length : 0;
      return {
        discoveryId: r.id,
        role: r.role,
        lastSeenAt: r.lastSeenAt,
        firstDiscoveredAt: r.firstDiscoveredAt,
        email: {
          id: r.emailMessage.id,
          subject: r.emailMessage.subject,
          senderName: r.emailMessage.senderName,
          senderEmail: r.emailMessage.senderEmail,
          sentAt: r.emailMessage.sentAt,
          receivedAt: r.emailMessage.receivedAt,
          hasAttachments: r.emailMessage.hasAttachments,
          attachmentCount,
          jobId: r.emailMessage.jobId,
        },
      };
    }),
  };
}

export async function countBidFolderDiscoveryByRole(input: {
  prisma: PrismaClient;
  workspaceId: string;
  connectionId: string;
}): Promise<{ bidInvites: number; quotes: number }> {
  const [bidInvites, quotes] = await Promise.all([
    input.prisma.bidFolderDiscoveryEmail.count({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.connectionId,
        role: "BID_INVITE",
      },
    }),
    input.prisma.bidFolderDiscoveryEmail.count({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.connectionId,
        role: "QUOTE",
      },
    }),
  ]);
  return { bidInvites, quotes };
}
