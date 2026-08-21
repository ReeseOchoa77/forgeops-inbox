import { normalizeEmail } from "@forgeops/shared";
import type { PrismaClient } from "@prisma/client";

export type EmailContactSuggestion = {
  name: string | null;
  email: string;
  organization: string | null;
  source: "CONTACT" | "CUSTOMER" | "VENDOR" | "MEMBER" | "EMAIL_HISTORY";
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function scoreSuggestion(q: string, s: EmailContactSuggestion): number {
  const email = s.email.toLowerCase();
  const name = (s.name ?? "").toLowerCase();
  const org = (s.organization ?? "").toLowerCase();
  if (email === q) return 1000;
  if (email.startsWith(q)) return 900;
  if (email.includes(q)) return 700;
  if (name.startsWith(q)) return 600;
  if (name.includes(q)) return 400;
  if (org.startsWith(q)) return 300;
  if (org.includes(q)) return 200;
  return 0;
}

function upsertCandidate(
  map: Map<string, EmailContactSuggestion & { score: number }>,
  candidate: EmailContactSuggestion,
  q: string
) {
  if (!isValidEmail(candidate.email)) return;
  const key = normalizeEmail(candidate.email);
  const score = scoreSuggestion(q, candidate);
  if (score <= 0 && q.length > 0) return;
  const existing = map.get(key);
  if (!existing || score > existing.score) {
    map.set(key, { ...candidate, email: key, score });
  }
}

function extractEmailsFromJson(value: unknown): Array<{ email: string; name: string | null }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ email: string; name: string | null }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const email =
      typeof (item as { email?: unknown }).email === "string"
        ? (item as { email: string }).email
        : null;
    if (!email) continue;
    const name =
      typeof (item as { name?: unknown }).name === "string"
        ? (item as { name: string }).name
        : null;
    out.push({ email, name });
  }
  return out;
}

/**
 * Workspace-scoped email contact search for compose autocomplete.
 * Dedupes by normalized email; does not scan unbounded history.
 */
export async function searchWorkspaceEmailContacts(
  prisma: PrismaClient,
  input: { workspaceId: string; q: string; limit: number }
): Promise<EmailContactSuggestion[]> {
  const q = input.q.trim().toLowerCase();
  if (q.length < 1) return [];
  const limit = Math.min(Math.max(input.limit, 1), 20);
  const map = new Map<string, EmailContactSuggestion & { score: number }>();

  const [contacts, customers, vendors, members, recentMessages] =
    await Promise.all([
      prisma.entityContact.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          name: true,
          email: true,
          customer: { select: { name: true } },
          vendor: { select: { name: true } },
        },
        take: 30,
      }),
      prisma.customer.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { primaryEmail: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { name: true, primaryEmail: true },
        take: 20,
      }),
      prisma.vendor.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { primaryEmail: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { name: true, primaryEmail: true },
        take: 20,
      }),
      prisma.membership.findMany({
        where: {
          workspaceId: input.workspaceId,
          user: {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          },
        },
        select: { user: { select: { email: true, name: true } } },
        take: 20,
      }),
      prisma.emailMessage.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { senderEmail: { contains: q, mode: "insensitive" } },
            { senderName: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          senderEmail: true,
          senderName: true,
          toAddresses: true,
          ccAddresses: true,
        },
        orderBy: { receivedAt: "desc" },
        take: 40,
      }),
    ]);

  for (const c of contacts) {
    if (!c.email) continue;
    upsertCandidate(
      map,
      {
        name: c.name,
        email: c.email,
        organization: c.customer?.name ?? c.vendor?.name ?? null,
        source: "CONTACT",
      },
      q
    );
  }
  for (const c of customers) {
    if (!c.primaryEmail) continue;
    upsertCandidate(
      map,
      {
        name: c.name,
        email: c.primaryEmail,
        organization: c.name,
        source: "CUSTOMER",
      },
      q
    );
  }
  for (const v of vendors) {
    if (!v.primaryEmail) continue;
    upsertCandidate(
      map,
      {
        name: v.name,
        email: v.primaryEmail,
        organization: v.name,
        source: "VENDOR",
      },
      q
    );
  }
  for (const m of members) {
    upsertCandidate(
      map,
      {
        name: m.user.name,
        email: m.user.email,
        organization: null,
        source: "MEMBER",
      },
      q
    );
  }
  for (const msg of recentMessages) {
    upsertCandidate(
      map,
      {
        name: msg.senderName,
        email: msg.senderEmail,
        organization: null,
        source: "EMAIL_HISTORY",
      },
      q
    );
    for (const addr of [
      ...extractEmailsFromJson(msg.toAddresses),
      ...extractEmailsFromJson(msg.ccAddresses),
    ]) {
      if (!addr.email.toLowerCase().includes(q) && !(addr.name ?? "").toLowerCase().includes(q)) {
        continue;
      }
      upsertCandidate(
        map,
        {
          name: addr.name,
          email: addr.email,
          organization: null,
          source: "EMAIL_HISTORY",
        },
        q
      );
    }
  }

  return [...map.values()]
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}
