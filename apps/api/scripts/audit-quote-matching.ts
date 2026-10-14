/**
 * LOCAL AUDIT ONLY — dump Quote grouping / Bid source / existing Job state.
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const quotes = await p.bidQuoteStaging.findMany({
    where: { matchStatus: { not: "REJECTED" } },
    include: {
      emailMessage: {
        select: {
          id: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          threadId: true,
          receivedAt: true,
        },
      },
      bidCandidate: {
        select: {
          id: true,
          proposedProjectName: true,
          proposedCustomerName: true,
          proposedJobNumber: true,
          status: true,
          originalBidSource: true,
          identityKey: true,
          existingJobMatchStatus: true,
          existingJobMatchConfidence: true,
          existingJobMatchEvidence: true,
          proposedExistingJobId: true,
          proposedExistingJob: {
            select: { id: true, name: true, jobNumber: true, status: true },
          },
          evidence: true,
          confidence: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates = await p.bidCandidate.findMany({
    where: { status: { notIn: ["CONFIRMED", "REJECTED"] } },
    include: {
      quoteStagings: {
        where: { matchStatus: { not: "REJECTED" } },
        include: {
          emailMessage: {
            select: { subject: true, senderName: true, threadId: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      emails: {
        include: {
          emailMessage: {
            select: {
              subject: true,
              senderName: true,
              senderEmail: true,
              receivedAt: true,
              inboxConnectionId: true,
            },
          },
        },
      },
      proposedExistingJob: {
        select: { id: true, name: true, jobNumber: true },
      },
    },
    orderBy: { proposedProjectName: "asc" },
  });

  const byStatus = await p.bidQuoteStaging.groupBy({
    by: ["matchStatus"],
    _count: true,
  });
  const unlinked = quotes.filter((q) => !q.bidCandidateId);
  const multi = candidates.filter((c) => c.quoteStagings.length > 1);

  const sourceCounts = {
    BID_INVITES_FOLDER: 0,
    INBOX_FALLBACK: 0,
    NONE: 0,
    OTHER: 0,
  };
  for (const c of candidates) {
    const s = c.originalBidSource as keyof typeof sourceCounts;
    if (s in sourceCounts) sourceCounts[s] += 1;
    else sourceCounts.OTHER += 1;
  }

  const existingJob = await p.bidCandidate.groupBy({
    by: ["existingJobMatchStatus"],
    where: { status: { notIn: ["CONFIRMED", "REJECTED"] } },
    _count: true,
  });

  // ESC / Zayo / Morries
  const needle = /esc|zayo|morries|cadillac|swing\s*space/i;
  const interestingQuotes = quotes.filter(
    (q) =>
      needle.test(q.sourceSubject ?? "") ||
      needle.test(q.displayName ?? "") ||
      needle.test(q.emailMessage.subject ?? "") ||
      needle.test(q.bidCandidate?.proposedProjectName ?? "")
  );
  const interestingCands = candidates.filter(
    (c) =>
      needle.test(c.proposedProjectName ?? "") ||
      c.quoteStagings.some(
        (q) =>
          needle.test(q.sourceSubject ?? "") ||
          needle.test(q.emailMessage.subject ?? "")
      )
  );

  let extraFromMulti = 0;
  const multiReport = multi.map((c) => {
    const n = c.quoteStagings.length;
    const extra = n - 1;
    extraFromMulti += extra;
    return {
      id: c.id,
      name: c.proposedProjectName,
      customer: c.proposedCustomerName,
      jobNumber: c.proposedJobNumber,
      identityKey: c.identityKey,
      originalBidSource: c.originalBidSource,
      status: c.status,
      evidence: c.evidence,
      confidence: c.confidence != null ? Number(c.confidence) : null,
      existingJobMatchStatus: c.existingJobMatchStatus,
      existingJobMatchConfidence:
        c.existingJobMatchConfidence != null
          ? Number(c.existingJobMatchConfidence)
          : null,
      existingJobMatchEvidence: c.existingJobMatchEvidence,
      proposedExistingJob: c.proposedExistingJob,
      quoteCount: n,
      extraQuotes: extra,
      quotes: c.quoteStagings.map((q) => ({
        stagingId: q.id,
        subject: q.sourceSubject ?? q.emailMessage.subject,
        displayName: q.displayName,
        matchStatus: q.matchStatus,
        matchConfidence:
          q.matchConfidence != null ? Number(q.matchConfidence) : null,
        matchEvidence: q.matchEvidence,
        threadId: q.emailMessage.threadId,
        sender: q.emailMessage.senderName,
        amount: q.extractedAmount != null ? Number(q.extractedAmount) : null,
      })),
      bidEmails: c.emails
        .filter((e) => e.role !== "QUOTE")
        .map((e) => ({
          role: e.role,
          isPrimary: e.isPrimary,
          subject: e.emailMessage.subject,
          sender: e.emailMessage.senderName,
          matchConfidence:
            e.matchConfidence != null ? Number(e.matchConfidence) : null,
          matchEvidence: e.matchEvidence,
        })),
    };
  });

  const questionableJobs = candidates.filter(
    (c) =>
      ["POSSIBLE", "STRONG", "NEEDS_REVIEW"].includes(c.existingJobMatchStatus) &&
      c.proposedExistingJob
  );

  console.log(
    JSON.stringify(
      {
        totals: {
          quoteStagingNonRejected: quotes.length,
          quotesByMatchStatus: byStatus,
          unlinkedQuotes: unlinked.length,
          activeCandidates: candidates.length,
          multiQuoteCandidates: multi.length,
          extraQuotesFromMulti: extraFromMulti,
          arithmeticCheck: {
            formula: "candidates + extraFromMulti + unlinked",
            value: candidates.length + extraFromMulti + unlinked.length,
            expectedQuotes: quotes.length,
          },
          originalBidSource: sourceCounts,
          existingJobMatchStatus: existingJob,
        },
        unlinkedQuotes: unlinked.map((q) => ({
          id: q.id,
          subject: q.sourceSubject ?? q.emailMessage.subject,
          matchStatus: q.matchStatus,
          matchEvidence: q.matchEvidence,
        })),
        multiQuoteCandidates: multiReport,
        interestingQuotes: interestingQuotes.map((q) => ({
          id: q.id,
          subject: q.sourceSubject ?? q.emailMessage.subject,
          displayName: q.displayName,
          matchStatus: q.matchStatus,
          matchEvidence: q.matchEvidence,
          candidateId: q.bidCandidateId,
          candidateName: q.bidCandidate?.proposedProjectName,
          candidateIdentity: q.bidCandidate?.identityKey,
          candidateEvidence: q.bidCandidate?.evidence,
        })),
        interestingCandidates: interestingCands.map((c) => ({
          id: c.id,
          name: c.proposedProjectName,
          identityKey: c.identityKey,
          evidence: c.evidence,
          quotes: c.quoteStagings.map((q) => ({
            subject: q.sourceSubject ?? q.emailMessage.subject,
            matchEvidence: q.matchEvidence,
          })),
          bidEmails: c.emails.map((e) => ({
            role: e.role,
            subject: e.emailMessage.subject,
            matchEvidence: e.matchEvidence,
          })),
          existingJob: c.proposedExistingJob,
          existingJobMatchStatus: c.existingJobMatchStatus,
          existingJobMatchEvidence: c.existingJobMatchEvidence,
        })),
        questionableExistingJobs: questionableJobs.map((c) => ({
          candidate: c.proposedProjectName,
          candidateId: c.id,
          job: c.proposedExistingJob,
          status: c.existingJobMatchStatus,
          confidence:
            c.existingJobMatchConfidence != null
              ? Number(c.existingJobMatchConfidence)
              : null,
          evidence: c.existingJobMatchEvidence,
        })),
        lowConfidenceBidMatches: candidates
          .filter((c) => c.originalBidSource !== "NONE")
          .map((c) => {
            const primary = c.emails.find(
              (e) => e.isPrimary || e.role === "BID_INVITE"
            );
            return {
              candidate: c.proposedProjectName,
              source: c.originalBidSource,
              matchedSubject: primary?.emailMessage.subject,
              matchConfidence:
                primary?.matchConfidence != null
                  ? Number(primary.matchConfidence)
                  : null,
              matchEvidence: primary?.matchEvidence,
              candidateEvidence: c.evidence,
            };
          })
          .filter(
            (r) =>
              r.matchConfidence == null ||
              r.matchConfidence < 0.7 ||
              JSON.stringify(r.matchEvidence ?? {}).includes("ai_")
          ),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
