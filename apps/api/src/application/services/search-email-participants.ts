import type { PrismaClient } from "@prisma/client";
import {
  extractAddressRecords,
  rankInboxParticipants,
  type InboxParticipant,
} from "@forgeops/shared";

export type InboxParticipantRole = "sender" | "recipient";

/**
 * Workspace-scoped EmailMessage participant autocomplete.
 * Incoming → distinct senders. Sent → To/Cc recipients.
 */
export async function searchEmailParticipants(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    q: string;
    role: InboxParticipantRole;
    limit?: number;
  }
): Promise<InboxParticipant[]> {
  const q = input.q.trim();
  if (q.length < 1) return [];
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 10);
  const qLower = q.toLowerCase();

  if (input.role === "recipient") {
    const rows = await prisma.emailMessage.findMany({
      where: {
        workspaceId: input.workspaceId,
        isArchived: false,
        OR: [
          { toAddresses: { string_contains: q } },
          { toAddresses: { string_contains: qLower } },
          { ccAddresses: { string_contains: q } },
          { ccAddresses: { string_contains: qLower } },
        ],
      },
      select: { toAddresses: true, ccAddresses: true },
      orderBy: { sentAt: "desc" },
      take: 60,
    });
    const candidates: InboxParticipant[] = [];
    for (const row of rows) {
      candidates.push(
        ...extractAddressRecords(row.toAddresses),
        ...extractAddressRecords(row.ccAddresses)
      );
    }
    return rankInboxParticipants(q, candidates, limit);
  }

  const rows = await prisma.emailMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      isArchived: false,
      OR: [
        { senderEmail: { contains: q, mode: "insensitive" } },
        { senderName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { senderEmail: true, senderName: true },
    orderBy: { sentAt: "desc" },
    take: 80,
  });
  return rankInboxParticipants(
    q,
    rows.map((r) => ({ email: r.senderEmail, name: r.senderName })),
    limit
  );
}
