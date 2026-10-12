/**
 * Bulk Import BidCandidates → Jobs (OWNER/ADMIN only).
 * Staging pipeline never calls this — only explicit human Import.
 */

import type { PrismaClient } from "@prisma/client";
import { computeImportBlockedReason } from "./bid-import-eligibility.js";
import {
  canPromoteBidCandidate,
  PromoteBidCandidateError,
  promoteBidCandidate,
} from "./promote-bid-candidate.js";

export { computeImportBlockedReason };

export class ImportBidCandidatesError extends Error {
  readonly code: "FORBIDDEN" | "EMPTY";

  constructor(code: ImportBidCandidatesError["code"], message: string) {
    super(message);
    this.name = "ImportBidCandidatesError";
    this.code = code;
  }
}

export type ImportBidCandidatesResult = {
  imported: Array<{
    candidateId: string;
    jobId: string;
    created: boolean;
    attachedEmailCount: number;
    emailConflicts: Array<{
      emailMessageId: string;
      existingJobId: string;
      reason: string;
    }>;
  }>;
  failed: Array<{ candidateId: string; reason: string; code?: string }>;
  skipped: Array<{ candidateId: string; reason: string }>;
};

export async function importBidCandidates(input: {
  prisma: PrismaClient;
  workspaceId: string;
  userId: string;
  role: string;
  candidateIds: string[];
}): Promise<ImportBidCandidatesResult> {
  if (!canPromoteBidCandidate(input.role)) {
    throw new ImportBidCandidatesError(
      "FORBIDDEN",
      "Only OWNER/ADMIN can import bids"
    );
  }
  const ids = [...new Set(input.candidateIds.filter(Boolean))];
  if (ids.length === 0) {
    throw new ImportBidCandidatesError("EMPTY", "No candidate IDs provided");
  }

  const result: ImportBidCandidatesResult = {
    imported: [],
    failed: [],
    skipped: [],
  };

  for (const candidateId of ids) {
    const candidate = await input.prisma.bidCandidate.findFirst({
      where: { id: candidateId, workspaceId: input.workspaceId },
      select: {
        id: true,
        status: true,
        proposedProjectName: true,
        proposedExistingJobId: true,
        existingJobMatchStatus: true,
        canonicalJobId: true,
        importBlockedReason: true,
      },
    });

    if (!candidate) {
      result.failed.push({
        candidateId,
        reason: "Bid candidate not found",
        code: "NOT_FOUND",
      });
      continue;
    }

    if (candidate.status === "CONFIRMED" && candidate.canonicalJobId) {
      result.skipped.push({
        candidateId,
        reason: "Already imported",
      });
      continue;
    }

    const blocked =
      candidate.importBlockedReason ??
      computeImportBlockedReason(candidate);
    if (blocked) {
      result.failed.push({
        candidateId,
        reason: blocked,
        code: "NOT_ELIGIBLE",
      });
      continue;
    }

    const useAttach =
      candidate.existingJobMatchStatus === "RESOLVED_SAME" &&
      Boolean(candidate.proposedExistingJobId);

    try {
      const promoted = await promoteBidCandidate({
        prisma: input.prisma,
        workspaceId: input.workspaceId,
        candidateId: candidate.id,
        userId: input.userId,
        mode: useAttach ? "attach" : "create",
        ...(useAttach
          ? {
              existingJobId: candidate.proposedExistingJobId!,
              preserveJobFields: true,
            }
          : { confirmCreateDespiteExisting: true }),
      });
      result.imported.push({
        candidateId: promoted.candidateId,
        jobId: promoted.jobId,
        created: promoted.created,
        attachedEmailCount: promoted.attachedEmailCount,
        emailConflicts: promoted.emailConflicts.map((c) => ({
          emailMessageId: c.emailMessageId,
          existingJobId: c.existingJobId,
          reason: c.reason,
        })),
      });
      await input.prisma.bidCandidate.update({
        where: { id: candidate.id },
        data: {
          importBlockedReason: "Already imported",
          existingJobMatchStatus:
            useAttach
              ? "RESOLVED_SAME"
              : candidate.existingJobMatchStatus === "RESOLVED_DIFFERENT"
                ? "RESOLVED_DIFFERENT"
                : candidate.existingJobMatchStatus,
        },
      });
    } catch (e) {
      if (e instanceof PromoteBidCandidateError) {
        result.failed.push({
          candidateId,
          reason: e.message,
          code: e.code,
        });
      } else {
        result.failed.push({
          candidateId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return result;
}
