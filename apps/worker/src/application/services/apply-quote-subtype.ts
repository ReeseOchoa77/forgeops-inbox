/**
 * Deterministic Quote subtype for Projects/Quotes provenance.
 * No AI — folder placement is authoritative.
 * Does NOT mutate EmailMessage.direction.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  canReplaceClassificationAuthority,
  resolveClassificationAuthority,
  withClassificationAuthority,
} from "@forgeops/shared";

export const QUOTES_FOLDER_CLASSIFICATION_SOURCE = "quotes_folder";

export async function applyDeterministicQuoteSubtype(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  emailMessageIds: string[];
}): Promise<{ applied: number }> {
  const ids = [...new Set(input.emailMessageIds.filter(Boolean))];
  if (ids.length === 0) return { applied: 0 };

  const messages = await input.prisma.emailMessage.findMany({
    where: { workspaceId: input.workspaceId, id: { in: ids } },
    select: {
      id: true,
      threadId: true,
      classifications: {
        select: { reviewedByUserId: true, routingHints: true },
        take: 1,
      },
    },
  });

  let applied = 0;
  for (const msg of messages) {
    const existing = msg.classifications[0] ?? null;
    const existingAuthority = resolveClassificationAuthority({
      routingHints: existing?.routingHints,
      reviewedByUserId: existing?.reviewedByUserId,
    });
    if (
      !canReplaceClassificationAuthority({
        existing: existingAuthority,
        incoming: "SYSTEM_DETERMINISTIC",
      })
    ) {
      continue;
    }

    const routingHints = withClassificationAuthority(
      existing?.routingHints,
      "SYSTEM_DETERMINISTIC",
      QUOTES_FOLDER_CLASSIFICATION_SOURCE,
      { note: "Projects/Quotes folder provenance — not AI" }
    );

    await input.prisma.emailMessage.update({
      where: { id: msg.id },
      data: { mailboxCategory: "BUSINESS" },
    });

    await input.prisma.classification.upsert({
      where: {
        workspaceId_messageId: {
          workspaceId: input.workspaceId,
          messageId: msg.id,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        threadId: msg.threadId,
        messageId: msg.id,
        businessCategory: "BUSINESS",
        mailboxCategory: "BUSINESS",
        emailType: "FYI_UPDATE",
        businessTypeKey: "ESTIMATE_QUOTE",
        businessTypeConfidence: 1,
        confidence: 1,
        requiresReview: false,
        reviewStatus: "NOT_REQUIRED",
        routingHints: routingHints as Prisma.InputJsonValue,
        processedAt: new Date(),
        modelName: "deterministic-quotes-folder",
        modelVersion: "v1",
      },
      update: {
        businessCategory: "BUSINESS",
        mailboxCategory: "BUSINESS",
        businessTypeKey: "ESTIMATE_QUOTE",
        businessTypeConfidence: 1,
        routingHints: routingHints as Prisma.InputJsonValue,
        requiresReview: false,
        reviewStatus: "NOT_REQUIRED",
        modelName: "deterministic-quotes-folder",
        modelVersion: "v1",
        processedAt: new Date(),
      },
    });
    applied += 1;
  }

  return { applied };
}
