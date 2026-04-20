import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";

export const ensureDevelopmentWorkspace = async (
  prisma: PrismaClient,
  input: {
    userId: string;
    email: string;
    name?: string | null;
    enabled: boolean;
  }
): Promise<void> => {
  if (!input.enabled) {
    return;
  }

  const existingMembership = await prisma.membership.findFirst({
    where: {
      userId: input.userId
    },
    select: {
      id: true
    }
  });

  if (existingMembership) {
    return;
  }

  const baseName =
    input.name?.trim() ||
    `${input.email.split("@")[0] ?? "User"} Workspace`;

  await createDevelopmentWorkspace(prisma, {
    userId: input.userId,
    name: baseName
  });
};

export const createDevelopmentWorkspace = async (
  prisma: PrismaClient,
  input: {
    userId: string;
    name: string;
    timezone?: string;
  }
) =>
  prisma.workspace.create({
    data: {
      name: input.name,
      slug: `${slugify(input.name)}-${randomUUID().slice(0, 8)}`,
      timezone: input.timezone ?? "UTC",
      memberships: {
        create: {
          userId: input.userId,
          role: "OWNER"
        }
      }
    }
  });
