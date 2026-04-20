import type { PrismaClient } from "@prisma/client";

export const requireWorkspaceMembership = async (
  prisma: PrismaClient,
  userId: string,
  workspaceId: string
) => {
  const membership = await prisma.membership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId
      }
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true
        }
      }
    }
  });

  return membership;
};

export const listUserMemberships = async (
  prisma: PrismaClient,
  userId: string
) =>
  prisma.membership.findMany({
    where: {
      userId
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

