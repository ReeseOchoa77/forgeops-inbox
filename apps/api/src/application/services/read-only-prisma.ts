import { PrismaClient } from "@prisma/client";
import { assertReadOnlyPrismaOperation } from "@forgeops/shared";

/**
 * Prisma client that throws on write operations.
 * Used only by the job-matcher historical evaluator.
 */
export function createReadOnlyPrisma(): PrismaClient {
  if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  }
  const prisma = new PrismaClient({ log: ["error"] });
  const extended = prisma.$extends({
    name: "job-matcher-eval-readonly",
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          assertReadOnlyPrismaOperation(operation);
          return query(args);
        },
      },
    },
  });
  return extended as unknown as PrismaClient;
}
