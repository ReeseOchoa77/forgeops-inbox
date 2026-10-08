import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_ENTRIES = [
  {
    email: "24rochoa@gmail.com",
    role: "OWNER" as const
  }
];

async function main() {
  let workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true }
  });

  if (workspaces.length === 0) {
    const created = await prisma.workspace.create({
      data: {
        name: "Development",
        slug: `development-${randomUUID().slice(0, 8)}`
      },
      select: { id: true, name: true }
    });
    console.log(`Created default workspace: ${created.name} (${created.id})`);
    workspaces = [created];
  }

  for (const workspace of workspaces) {
    for (const entry of SEED_ENTRIES) {
      const normalizedEmail = entry.email.toLowerCase().trim();

      const result = await prisma.approvedAccess.upsert({
        where: {
          workspaceId_email: {
            workspaceId: workspace.id,
            email: normalizedEmail
          }
        },
        update: {
          status: "ACTIVE",
          role: entry.role
        },
        create: {
          email: normalizedEmail,
          workspaceId: workspace.id,
          role: entry.role,
          status: "ACTIVE"
        }
      });

      console.log(`Approved: ${result.email} → ${workspace.name} (${workspace.id}) as ${result.role}`);
    }
  }

  console.log("Seed complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
