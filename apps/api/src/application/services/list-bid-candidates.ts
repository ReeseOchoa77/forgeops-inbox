/**
 * Workspace-scoped permanent Bid Candidate listing (not mailbox-owned).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { activeBidListLifecycleWhere } from "./active-bid-candidate-membership.js";

export type BidCandidateListFilter = {
  quote?: "all" | "with" | "without";
  lifecycle?: Array<"OPEN" | "QUOTED" | "CONVERTED" | "LOST" | "ARCHIVED">;
  /** Due within N days (bid due). */
  dueSoonDays?: number | null;
  search?: string | null;
};

export function bidCandidatesWorkspaceWhere(input: {
  workspaceId: string;
  filter?: BidCandidateListFilter;
}): Prisma.BidCandidateWhereInput {
  const and: Prisma.BidCandidateWhereInput[] = [
    { workspaceId: input.workspaceId },
  ];

  const lifecycles = input.filter?.lifecycle;
  if (lifecycles && lifecycles.length > 0) {
    and.push({ lifecycle: { in: lifecycles } });
  } else {
    // Default operational list: exclude archived/lost/converted unless asked.
    and.push(activeBidListLifecycleWhere());
  }

  // Durable Quote evidence only — ephemeral unmatched staging must not flip these.
  const durableQuoteWhere: Prisma.BidCandidateWhereInput = {
    OR: [
      {
        quoteStagings: {
          some: {
            isDurable: true,
            matchStatus: { not: "REJECTED" },
          },
        },
      },
      {
        emails: {
          some: { role: "QUOTE" },
        },
      },
    ],
  };
  const quote = input.filter?.quote ?? "all";
  if (quote === "with") {
    and.push(durableQuoteWhere);
  } else if (quote === "without") {
    and.push({ NOT: durableQuoteWhere });
  }

  if (input.filter?.dueSoonDays != null && input.filter.dueSoonDays > 0) {
    const now = new Date();
    const until = new Date(
      now.getTime() + input.filter.dueSoonDays * 24 * 60 * 60 * 1000
    );
    and.push({
      proposedBidDueAt: { gte: now, lte: until },
    });
  }

  const search = input.filter?.search?.trim();
  if (search) {
    and.push({
      OR: [
        { proposedProjectName: { contains: search, mode: "insensitive" } },
        { proposedCustomerName: { contains: search, mode: "insensitive" } },
        { proposedNotes: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  return { AND: and };
}

export async function listBidCandidates(input: {
  prisma: PrismaClient;
  workspaceId: string;
  filter?: BidCandidateListFilter;
  take?: number;
}) {
  const whereArgs: {
    workspaceId: string;
    filter?: BidCandidateListFilter;
  } = { workspaceId: input.workspaceId };
  if (input.filter !== undefined) whereArgs.filter = input.filter;
  const where = bidCandidatesWorkspaceWhere(whereArgs);

  const rows = await input.prisma.bidCandidate.findMany({
    where,
    take: input.take ?? 200,
    orderBy: [
      { proposedBidDueAt: "asc" },
      { updatedAt: "desc" },
    ],
    select: {
      id: true,
      identityKey: true,
      lifecycle: true,
      status: true,
      proposedProjectName: true,
      proposedCustomerName: true,
      customerId: true,
      customer: { select: { id: true, name: true } },
      proposedBidDueAt: true,
      anticipatedStartAt: true,
      proposedScope: true,
      proposedNotes: true,
      proposedEstimatorUserId: true,
      proposedJobNumber: true,
      canonicalJobId: true,
      createdAt: true,
      updatedAt: true,
      quoteStagings: {
        where: {
          matchStatus: { not: "REJECTED" },
          isDurable: true,
        },
        select: {
          id: true,
          extractedAmount: true,
          currency: true,
          displayName: true,
          sourceSubject: true,
          matchStatus: true,
          isDurable: true,
        },
        orderBy: { createdAt: "asc" },
      },
      emails: {
        where: { role: "QUOTE" },
        select: { id: true },
      },
      _count: {
        select: {
          emails: true,
          quoteStagings: true,
        },
      },
    },
  });

  return rows.map((c) => {
    const quotes = c.quoteStagings;
    const amounts = quotes
      .map((q) => (q.extractedAmount != null ? Number(q.extractedAmount) : null))
      .filter((n): n is number => n != null);
    return {
      id: c.id,
      identityKey: c.identityKey,
      lifecycle: c.lifecycle,
      analysisStatus: c.status,
      projectName: c.proposedProjectName,
      customerName: c.customer?.name ?? c.proposedCustomerName,
      customerId: c.customerId,
      bidDueAt: c.proposedBidDueAt,
      anticipatedStartAt: c.anticipatedStartAt,
      scopeSummary: c.proposedScope,
      notes: c.proposedNotes,
      estimatorUserId: c.proposedEstimatorUserId,
      /** External identifier only — not a ForgeOps Job number. */
      externalProjectNumber: c.proposedJobNumber,
      quoteCount: Math.max(quotes.length, c.emails.length),
      emailCount: c._count.emails,
      quoteAmount:
        amounts.length > 0 ? amounts[amounts.length - 1]! : null,
      quoteCurrency: quotes[quotes.length - 1]?.currency ?? null,
      quotes: quotes.map((q) => ({
        id: q.id,
        displayName: q.displayName ?? q.sourceSubject,
        amount: q.extractedAmount != null ? Number(q.extractedAmount) : null,
        currency: q.currency,
        matchStatus: q.matchStatus,
      })),
      canonicalJobId: c.canonicalJobId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });
}
