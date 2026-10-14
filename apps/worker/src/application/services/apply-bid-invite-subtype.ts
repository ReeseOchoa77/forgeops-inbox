/**
 * Deterministic Bid Candidate subtype for Projects/Bid Invites provenance.
 * No AI — folder placement is authoritative.
 *
 * When recordFolderProvenance is true (default), also sets durable
 * EmailMessage.discoveredInBidInvitesFolder. Manual Candidate assignment must
 * pass false so ordinary Inbox emails do not enter the Bid Candidate filter.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  canReplaceClassificationAuthority,
  resolveClassificationAuthority,
  withClassificationAuthority,
} from "@forgeops/shared";

export const BID_INVITES_FOLDER_CLASSIFICATION_SOURCE = "bid_invites_folder";

export async function applyDeterministicBidInviteSubtype(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  emailMessageIds: string[];
  /**
   * When true (default): email was discovered in Projects/Bid Invites —
   * stamp durable filter provenance.
   * When false: subtype/authority update only (e.g. manual Assign to Candidate).
   */
  recordFolderProvenance?: boolean;
}): Promise<{ applied: number; provenanceMarked: number }> {
  const ids = [...new Set(input.emailMessageIds.filter(Boolean))];
  if (ids.length === 0) return { applied: 0, provenanceMarked: 0 };

  const recordFolderProvenance = input.recordFolderProvenance !== false;

  const messages = await input.prisma.emailMessage.findMany({
    where: { workspaceId: input.workspaceId, id: { in: ids } },
    select: {
      id: true,
      threadId: true,
      discoveredInBidInvitesFolder: true,
      classifications: {
        select: { reviewedByUserId: true, routingHints: true },
        take: 1,
      },
    },
  });

  let applied = 0;
  let provenanceMarked = 0;
  for (const msg of messages) {
    const existing = msg.classifications[0] ?? null;
    const existingAuthority = resolveClassificationAuthority({
      routingHints: existing?.routingHints,
      reviewedByUserId: existing?.reviewedByUserId,
    });
    const canApplySubtype = canReplaceClassificationAuthority({
      existing: existingAuthority,
      incoming: "SYSTEM_DETERMINISTIC",
    });

    // Durable folder provenance is independent of classification authority.
    // Once discovered in Projects/Bid Invites, never erase on reclassify/Clear Analysis.
    const needProvenance =
      recordFolderProvenance && !msg.discoveredInBidInvitesFolder;

    if (needProvenance || canApplySubtype) {
      await input.prisma.emailMessage.update({
        where: { id: msg.id },
        data: {
          ...(canApplySubtype ? { mailboxCategory: "BUSINESS" as const } : {}),
          ...(needProvenance || (recordFolderProvenance && canApplySubtype)
            ? { discoveredInBidInvitesFolder: true }
            : {}),
        },
      });
      if (needProvenance) provenanceMarked += 1;
    }

    if (!canApplySubtype) {
      continue;
    }

    const routingHints = withClassificationAuthority(
      existing?.routingHints,
      "SYSTEM_DETERMINISTIC",
      BID_INVITES_FOLDER_CLASSIFICATION_SOURCE,
      { note: "Projects/Bid Invites folder provenance — not AI" }
    );

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
        businessTypeKey: "BID_OPPORTUNITY",
        businessTypeConfidence: 1,
        confidence: 1,
        requiresReview: false,
        reviewStatus: "NOT_REQUIRED",
        routingHints: routingHints as Prisma.InputJsonValue,
        processedAt: new Date(),
        modelName: "deterministic-bid-invites-folder",
        modelVersion: "v1",
      },
      update: {
        businessCategory: "BUSINESS",
        mailboxCategory: "BUSINESS",
        businessTypeKey: "BID_OPPORTUNITY",
        businessTypeConfidence: 1,
        routingHints: routingHints as Prisma.InputJsonValue,
        requiresReview: false,
        reviewStatus: "NOT_REQUIRED",
        modelName: "deterministic-bid-invites-folder",
        modelVersion: "v1",
        processedAt: new Date(),
      },
    });
    applied += 1;
  }

  return { applied, provenanceMarked };
}
