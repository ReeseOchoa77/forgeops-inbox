/**
 * Persist USER_EXPLICIT business subtype (ForgeOps compose or manual correction).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isBusinessSubtypeKey,
  withClassificationAuthority,
} from "@forgeops/shared";

export async function persistUserExplicitClassification(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  threadId: string;
  emailMessageId: string;
  businessTypeKey: string;
  userId: string;
  source?: string;
}): Promise<void> {
  if (!isBusinessSubtypeKey(input.businessTypeKey)) {
    throw new Error(`Invalid business subtype: ${input.businessTypeKey}`);
  }

  const routingHints = withClassificationAuthority(
    null,
    "USER_EXPLICIT",
    input.source ?? "forgeops_compose",
    {
      composedInForgeOps: input.source === "forgeops_compose" || !input.source,
      note: "User-selected Email Type — AI must not overwrite",
    }
  );

  await input.prisma.classification.upsert({
    where: {
      workspaceId_messageId: {
        workspaceId: input.workspaceId,
        messageId: input.emailMessageId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      messageId: input.emailMessageId,
      businessCategory: "BUSINESS",
      mailboxCategory: "BUSINESS",
      emailType: "FYI_UPDATE",
      businessTypeKey: input.businessTypeKey,
      businessTypeConfidence: 1,
      confidence: 1,
      requiresReview: false,
      reviewStatus: "APPROVED",
      reviewedByUserId: input.userId,
      reviewedAt: new Date(),
      routingHints: routingHints as Prisma.InputJsonValue,
      processedAt: new Date(),
      modelName: "user-explicit",
      modelVersion: "v1",
    },
    update: {
      businessCategory: "BUSINESS",
      mailboxCategory: "BUSINESS",
      businessTypeKey: input.businessTypeKey,
      businessTypeConfidence: 1,
      requiresReview: false,
      reviewStatus: "APPROVED",
      reviewedByUserId: input.userId,
      reviewedAt: new Date(),
      routingHints: routingHints as Prisma.InputJsonValue,
      modelName: "user-explicit",
      modelVersion: "v1",
      processedAt: new Date(),
    },
  });
}
