/**
 * BidQuoteStaging list / patch (reassign, unmatch, reject, edit fields).
 * Never mutates EmailMessage.subject or deletes EmailMessage.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

export class BidQuoteStagingError extends Error {
  readonly code: "NOT_FOUND" | "CANDIDATE_NOT_FOUND" | "INVALID";

  constructor(code: BidQuoteStagingError["code"], message: string) {
    super(message);
    this.name = "BidQuoteStagingError";
    this.code = code;
  }
}

function lockedFields(userEditedFields: unknown): Set<string> {
  if (!Array.isArray(userEditedFields)) return new Set();
  return new Set(
    userEditedFields.filter((k): k is string => typeof k === "string")
  );
}

export async function listBidQuoteStaging(input: {
  prisma: PrismaClient;
  workspaceId: string;
  connectionId?: string;
  matchStatus?: string;
  includeRejected?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{
  total: number;
  page: number;
  pageSize: number;
  quotes: Array<{
    id: string;
    emailMessageId: string;
    sourceSubject: string | null;
    displayName: string | null;
    extractedScope: string | null;
    extractedAmount: number | null;
    currency: string | null;
    extractedNotes: string | null;
    extractionEvidence: unknown;
    extractionConfidence: number | null;
    userEditedFields: unknown;
    matchStatus: string;
    matchConfidence: number | null;
    bidCandidateId: string | null;
    bidCandidateName: string | null;
    userConfirmedMatch: boolean;
    rejectedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }>;
}> {
  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? 50, 100);
  const where: Prisma.BidQuoteStagingWhereInput = {
    workspaceId: input.workspaceId,
    ...(input.connectionId
      ? { inboxConnectionId: input.connectionId }
      : {}),
    ...(input.matchStatus
      ? {
          matchStatus: input.matchStatus as
            | "UNMATCHED"
            | "POSSIBLE_MATCH"
            | "MATCHED"
            | "NEEDS_REVIEW"
            | "USER_UNMATCHED"
            | "REJECTED",
        }
      : input.includeRejected
        ? {}
        : { matchStatus: { not: "REJECTED" as const } }),
  };

  const [total, rows] = await Promise.all([
    input.prisma.bidQuoteStaging.count({ where }),
    input.prisma.bidQuoteStaging.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        bidCandidate: {
          select: { id: true, proposedProjectName: true },
        },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    quotes: rows.map((q) => ({
      id: q.id,
      emailMessageId: q.emailMessageId,
      sourceSubject: q.sourceSubject,
      displayName: q.displayName,
      extractedScope: q.extractedScope,
      extractedAmount:
        q.extractedAmount != null ? Number(q.extractedAmount) : null,
      currency: q.currency,
      extractedNotes: q.extractedNotes,
      extractionEvidence: q.extractionEvidence,
      extractionConfidence:
        q.extractionConfidence != null ? Number(q.extractionConfidence) : null,
      userEditedFields: q.userEditedFields,
      matchStatus: q.matchStatus,
      matchConfidence:
        q.matchConfidence != null ? Number(q.matchConfidence) : null,
      bidCandidateId: q.bidCandidateId,
      bidCandidateName: q.bidCandidate?.proposedProjectName ?? null,
      userConfirmedMatch: q.userConfirmedMatch,
      rejectedAt: q.rejectedAt,
      updatedAt: q.updatedAt,
      createdAt: q.createdAt,
    })),
  };
}

export async function updateBidQuoteStaging(input: {
  prisma: PrismaClient;
  workspaceId: string;
  quoteId: string;
  bidCandidateId?: string | null;
  unmatch?: boolean;
  reject?: boolean;
  displayName?: string | null;
  extractedScope?: string | null;
  extractedAmount?: number | null;
  currency?: string | null;
  extractedNotes?: string | null;
}): Promise<{ quoteId: string }> {
  const quote = await input.prisma.bidQuoteStaging.findFirst({
    where: { id: input.quoteId, workspaceId: input.workspaceId },
    select: {
      id: true,
      emailMessageId: true,
      bidCandidateId: true,
      matchStatus: true,
      userEditedFields: true,
    },
  });
  if (!quote) {
    throw new BidQuoteStagingError("NOT_FOUND", "Quote staging row not found");
  }

  if (input.extractedAmount !== undefined && input.extractedAmount != null) {
    if (!Number.isFinite(input.extractedAmount)) {
      throw new BidQuoteStagingError("INVALID", "Quote amount must be a number");
    }
  }

  if (input.reject) {
    if (quote.bidCandidateId) {
      await input.prisma.bidCandidateEmail.deleteMany({
        where: {
          bidCandidateId: quote.bidCandidateId,
          emailMessageId: quote.emailMessageId,
          role: "QUOTE",
        },
      });
    }
    await input.prisma.bidQuoteStaging.update({
      where: { id: quote.id },
      data: {
        bidCandidateId: null,
        matchStatus: "REJECTED",
        matchConfidence: null,
        userConfirmedMatch: true,
        rejectedAt: new Date(),
      },
    });
    return { quoteId: quote.id };
  }

  if (input.unmatch) {
    if (quote.bidCandidateId) {
      await input.prisma.bidCandidateEmail.deleteMany({
        where: {
          bidCandidateId: quote.bidCandidateId,
          emailMessageId: quote.emailMessageId,
          role: "QUOTE",
        },
      });
    }
    await input.prisma.bidQuoteStaging.update({
      where: { id: quote.id },
      data: {
        bidCandidateId: null,
        matchStatus: "USER_UNMATCHED",
        matchConfidence: null,
        userConfirmedMatch: true,
        rejectedAt: null,
      },
    });
    return { quoteId: quote.id };
  }

  const locked = lockedFields(quote.userEditedFields);
  if (input.displayName !== undefined) locked.add("displayName");
  if (input.extractedScope !== undefined) locked.add("extractedScope");
  if (input.extractedAmount !== undefined) locked.add("extractedAmount");
  if (input.currency !== undefined) locked.add("currency");
  if (input.extractedNotes !== undefined) locked.add("extractedNotes");

  const fieldPatch = {
    ...(input.displayName !== undefined
      ? { displayName: input.displayName?.trim() || null }
      : {}),
    ...(input.extractedScope !== undefined
      ? { extractedScope: input.extractedScope }
      : {}),
    ...(input.extractedAmount !== undefined
      ? { extractedAmount: input.extractedAmount }
      : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.extractedNotes !== undefined
      ? { extractedNotes: input.extractedNotes }
      : {}),
    userEditedFields: [...locked] as Prisma.InputJsonValue,
  };

  if (input.bidCandidateId !== undefined) {
    if (input.bidCandidateId === null) {
      if (quote.bidCandidateId) {
        await input.prisma.bidCandidateEmail.deleteMany({
          where: {
            bidCandidateId: quote.bidCandidateId,
            emailMessageId: quote.emailMessageId,
            role: "QUOTE",
          },
        });
      }
      await input.prisma.bidQuoteStaging.update({
        where: { id: quote.id },
        data: {
          ...fieldPatch,
          bidCandidateId: null,
          matchStatus: "USER_UNMATCHED",
          userConfirmedMatch: true,
          rejectedAt: null,
        },
      });
      return { quoteId: quote.id };
    }

    const candidate = await input.prisma.bidCandidate.findFirst({
      where: {
        id: input.bidCandidateId,
        workspaceId: input.workspaceId,
        status: { notIn: ["CONFIRMED", "REJECTED"] },
      },
      select: { id: true },
    });
    if (!candidate) {
      throw new BidQuoteStagingError(
        "CANDIDATE_NOT_FOUND",
        "Target bid candidate not found or not editable"
      );
    }

    if (quote.bidCandidateId && quote.bidCandidateId !== candidate.id) {
      await input.prisma.bidCandidateEmail.deleteMany({
        where: {
          bidCandidateId: quote.bidCandidateId,
          emailMessageId: quote.emailMessageId,
          role: "QUOTE",
        },
      });
    }

    await input.prisma.$transaction([
      input.prisma.bidQuoteStaging.update({
        where: { id: quote.id },
        data: {
          ...fieldPatch,
          bidCandidateId: candidate.id,
          matchStatus: "MATCHED",
          matchConfidence: 1,
          userConfirmedMatch: true,
          rejectedAt: null,
          matchEvidence: { labels: ["user_reassign"] },
        },
      }),
      input.prisma.bidCandidateEmail.upsert({
        where: {
          bidCandidateId_emailMessageId: {
            bidCandidateId: candidate.id,
            emailMessageId: quote.emailMessageId,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          bidCandidateId: candidate.id,
          emailMessageId: quote.emailMessageId,
          role: "QUOTE",
          matchConfidence: 1,
          matchEvidence: { labels: ["user_reassign"] },
        },
        update: {
          matchConfidence: 1,
          matchEvidence: { labels: ["user_reassign"] },
        },
      }),
    ]);
    return { quoteId: quote.id };
  }

  await input.prisma.bidQuoteStaging.update({
    where: { id: quote.id },
    data: fieldPatch,
  });
  return { quoteId: quote.id };
}
