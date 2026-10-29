import type { PrismaClient, Prisma } from "@prisma/client";

export type JobEmailContactDto = {
  id: string;
  contactId: string;
  name: string | null;
  email: string | null;
  source: "LEARNED_FROM_EMAIL" | "MANUAL";
  firstEmailMessageId: string | null;
  lastSeenAt: string;
};

function compareContacts(a: JobEmailContactDto, b: JobEmailContactDto): number {
  const seen = b.lastSeenAt.localeCompare(a.lastSeenAt);
  if (seen !== 0) return seen;
  const nameA = (a.name ?? "").toLowerCase();
  const nameB = (b.name ?? "").toLowerCase();
  if (nameA !== nameB) return nameA.localeCompare(nameB);
  return (a.email ?? "").toLowerCase().localeCompare((b.email ?? "").toLowerCase());
}

export function presentJobEmailContact(row: {
  id: string;
  contactId: string;
  source: string;
  firstEmailMessageId: string | null;
  lastSeenAt: Date;
  contact: { name: string | null; email: string | null };
}): JobEmailContactDto {
  return {
    id: row.id,
    contactId: row.contactId,
    name: row.contact.name,
    email: row.contact.email,
    source: row.source === "MANUAL" ? "MANUAL" : "LEARNED_FROM_EMAIL",
    firstEmailMessageId: row.firstEmailMessageId,
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

export async function listJobEmailContacts(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { workspaceId: string; jobId: string }
): Promise<JobEmailContactDto[]> {
  const rows = await prisma.jobEmailContact.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    select: {
      id: true,
      contactId: true,
      source: true,
      firstEmailMessageId: true,
      lastSeenAt: true,
      contact: { select: { name: true, email: true } },
    },
  });
  return rows.map(presentJobEmailContact).sort(compareContacts);
}
