import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_ENTRIES = [
  {
    email: "24rochoa@gmail.com",
    role: "OWNER" as const
  }
];

async function main() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true }
  });

  if (workspaces.length === 0) {
    console.error("No workspaces found. Sign in once first to create a dev workspace, then run this seed.");
    process.exit(1);
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
