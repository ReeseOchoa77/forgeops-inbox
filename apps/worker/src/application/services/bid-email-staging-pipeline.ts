/**
 * Staging-only Bid Candidate / Quote extract + match + existing-Job proposal.
 * NEVER creates Jobs. NEVER writes EmailMessage.jobId.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildBidCandidateIdentityKey,
  extractBidDueDateDeterministic,
  extractDomain,
  extractQuoteFieldsDeterministic,
  rankJobMatchCandidates,
  resolveBidProjectIdentity,
  scoreQuoteToBidCandidate,
  suggestBidProjectNameFromSubject,
  QUOTE_AUTO_LINK_THRESHOLD,
  QUOTE_REVIEW_THRESHOLD,
  type BidEmailAnalyzeProgress,
} from "@forgeops/shared";

import { createPrismaJobMatchLoader } from "./prisma-job-match-loader.js";

function lockedFields(userEditedFields: unknown): Set<string> {
  if (!Array.isArray(userEditedFields)) return new Set();
  return new Set(
    userEditedFields.filter((k): k is string => typeof k === "string")
  );
}

function extractInviteFields(msg: {
  subject: string | null;
  bodyText: string | null;
  senderName: string | null;
  attachmentMetadata: unknown;
}) {
  const filenames: string[] = [];
  if (Array.isArray(msg.attachmentMetadata)) {
    for (const a of msg.attachmentMetadata) {
      if (
        a &&
        typeof a === "object" &&
        typeof (a as { filename?: unknown }).filename === "string"
      ) {
        filenames.push((a as { filename: string }).filename);
      }
    }
  }
  const identity = resolveBidProjectIdentity({
    subject: msg.subject,
    bodyText: msg.bodyText,
    pdfFilenames: filenames,
    customerCompanyName: null,
  });
  const dueYmd = extractBidDueDateDeterministic({
    subject: msg.subject,
    bodyText: msg.bodyText,
  });
  const projectName =
    identity.projectName ?? suggestBidProjectNameFromSubject(msg.subject);
  const jobNumberMatch = (msg.subject ?? "").match(/\b(\d{2,6})\b/)?.[1] ?? null;

  return {
    projectName,
    projectNumber: jobNumberMatch,
    customerName: msg.senderName?.trim() || null,
    bidDueAt: dueYmd ? new Date(`${dueYmd}T00:00:00.000Z`) : null,
    attachmentNames: filenames,
    alternateNames: identity.alternateProjectNames,
  };
}

export function computeImportBlockedReason(c: {
  status: string;
  proposedProjectName: string | null;
  existingJobMatchStatus: string;
}): string | null {
  if (c.status === "CONFIRMED") return "Already imported";
  if (c.status === "REJECTED") return "Rejected";
  if (!c.proposedProjectName?.trim()) return "Missing project name";
  if (
    c.existingJobMatchStatus === "POSSIBLE" ||
    c.existingJobMatchStatus === "STRONG" ||
    c.existingJobMatchStatus === "NEEDS_REVIEW"
  ) {
    return "Unresolved existing Job match";
  }
  if (c.status === "NEEDS_REVIEW") return "Needs review";
  return null;
}

async function writeProgress(
  prisma: PrismaClient,
  runId: string,
  progress: BidEmailAnalyzeProgress
): Promise<void> {
  await prisma.bidAnalysisRun.update({
    where: { id: runId },
    data: { progress: progress as unknown as Prisma.InputJsonValue },
  });
}

/** Extract BidCandidates from Bid Invite discovery (override-safe). */
export async function extractBidCandidatesFromDiscovery(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
}): Promise<void> {
  input.progress.currentPhase = "EXTRACTING_BID_CANDIDATES";
  await writeProgress(input.prisma, input.runId, input.progress);

  const inviteIds = (
    await input.prisma.bidFolderDiscoveryEmail.findMany({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        role: "BID_INVITE",
      },
      select: { emailMessageId: true },
      orderBy: { firstDiscoveredAt: "asc" },
    })
  ).map((d) => d.emailMessageId);

  input.progress.bidInvitesFound = inviteIds.length;

  for (const emailMessageId of inviteIds) {
    const email = await input.prisma.emailMessage.findFirst({
      where: { id: emailMessageId, workspaceId: input.workspaceId },
      select: {
        id: true,
        subject: true,
        bodyText: true,
        senderName: true,
        senderEmail: true,
        attachmentMetadata: true,
      },
    });
    if (!email) continue;
    const fields = extractInviteFields(email);
    const identityKey = buildBidCandidateIdentityKey({
      projectNumber: fields.projectNumber,
      projectName: fields.projectName,
      customerName: fields.customerName,
      fallbackMessageId: email.id,
    });
    if (!identityKey) continue;

    const existing = await input.prisma.bidCandidate.findUnique({
      where: {
        workspaceId_identityKey: {
          workspaceId: input.workspaceId,
          identityKey,
        },
      },
      select: {
        id: true,
        status: true,
        userEditedFields: true,
        proposedProjectName: true,
        proposedCustomerName: true,
        proposedBidDueAt: true,
        proposedJobNumber: true,
        existingJobMatchStatus: true,
      },
    });

    let candidateId: string;
    if (existing) {
      candidateId = existing.id;
      if (existing.status !== "CONFIRMED" && existing.status !== "REJECTED") {
        const locked = lockedFields(existing.userEditedFields);
        const nextName = locked.has("proposedProjectName")
          ? existing.proposedProjectName
          : fields.projectName ?? existing.proposedProjectName;
        const nextCustomer = locked.has("proposedCustomerName")
          ? existing.proposedCustomerName
          : fields.customerName ?? existing.proposedCustomerName;
        const nextDue = locked.has("proposedBidDueAt")
          ? existing.proposedBidDueAt
          : fields.bidDueAt ?? existing.proposedBidDueAt;
        const nextNumber = locked.has("proposedJobNumber")
          ? existing.proposedJobNumber
          : fields.projectNumber ?? existing.proposedJobNumber;
        const status =
          nextName && nextDue
            ? "READY"
            : nextName
              ? "DISCOVERED"
              : "NEEDS_REVIEW";
        await input.prisma.bidCandidate.update({
          where: { id: existing.id },
          data: {
            proposedProjectName: nextName,
            proposedCustomerName: nextCustomer,
            proposedBidDueAt: nextDue,
            proposedJobNumber: nextNumber,
            evidence: {
              alternateNames: fields.alternateNames,
              attachments: fields.attachmentNames.slice(0, 20),
            } as Prisma.InputJsonValue,
            status,
            confidence: nextName ? 0.75 : 0.4,
            importBlockedReason: computeImportBlockedReason({
              status,
              proposedProjectName: nextName,
              existingJobMatchStatus: existing.existingJobMatchStatus,
            }),
          },
        });
        input.progress.candidatesUpdated += 1;
      } else {
        input.progress.candidatesUpdated += 1;
      }
    } else {
      const status =
        fields.projectName && fields.bidDueAt
          ? "READY"
          : fields.projectName
            ? "DISCOVERED"
            : "NEEDS_REVIEW";
      const created = await input.prisma.bidCandidate.create({
        data: {
          workspaceId: input.workspaceId,
          identityKey,
          proposedProjectName: fields.projectName,
          proposedCustomerName: fields.customerName,
          proposedBidDueAt: fields.bidDueAt,
          proposedJobNumber: fields.projectNumber,
          evidence: {
            alternateNames: fields.alternateNames,
            attachments: fields.attachmentNames.slice(0, 20),
          } as Prisma.InputJsonValue,
          status,
          confidence: fields.projectName ? 0.75 : 0.35,
          importBlockedReason: computeImportBlockedReason({
            status,
            proposedProjectName: fields.projectName,
            existingJobMatchStatus: "NONE",
          }),
        },
      });
      candidateId = created.id;
      input.progress.candidatesCreated += 1;
    }

    await input.prisma.bidCandidateEmail.upsert({
      where: {
        bidCandidateId_emailMessageId: {
          bidCandidateId: candidateId,
          emailMessageId: email.id,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        bidCandidateId: candidateId,
        emailMessageId: email.id,
        role: "BID_INVITE",
        isPrimary: !existing,
      },
      update: {},
    });
  }

  await writeProgress(input.prisma, input.runId, input.progress);
}

/** Extract BidQuoteStaging rows from Quote discovery. */
export async function extractQuotesFromDiscovery(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
}): Promise<void> {
  input.progress.currentPhase = "EXTRACTING_QUOTES";
  await writeProgress(input.prisma, input.runId, input.progress);

  const quoteIds = (
    await input.prisma.bidFolderDiscoveryEmail.findMany({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        role: "QUOTE",
      },
      select: { emailMessageId: true },
      orderBy: { firstDiscoveredAt: "asc" },
    })
  ).map((d) => d.emailMessageId);

  input.progress.quotesFound = quoteIds.length;
  let extracted = 0;

  for (const emailMessageId of quoteIds) {
    const email = await input.prisma.emailMessage.findFirst({
      where: { id: emailMessageId, workspaceId: input.workspaceId },
      select: {
        id: true,
        subject: true,
        bodyText: true,
        attachmentMetadata: true,
      },
    });
    if (!email) continue;

    const filenames: string[] = [];
    if (Array.isArray(email.attachmentMetadata)) {
      for (const a of email.attachmentMetadata) {
        if (
          a &&
          typeof a === "object" &&
          typeof (a as { filename?: unknown }).filename === "string"
        ) {
          filenames.push((a as { filename: string }).filename);
        }
      }
    }
    const fields = extractQuoteFieldsDeterministic({
      subject: email.subject,
      bodyText: email.bodyText,
      attachmentNames: filenames,
    });

    const existing = await input.prisma.bidQuoteStaging.findUnique({
      where: {
        workspaceId_emailMessageId: {
          workspaceId: input.workspaceId,
          emailMessageId: email.id,
        },
      },
      select: { id: true, userConfirmedMatch: true },
    });

    if (existing) {
      // Preserve user-confirmed match linkage; refresh extraction fields only.
      await input.prisma.bidQuoteStaging.update({
        where: { id: existing.id },
        data: {
          sourceSubject: email.subject,
          extractedScope: fields.scope,
          extractedAmount: fields.amount,
          currency: fields.currency,
          extractedNotes: fields.notes,
          extractionEvidence: { labels: fields.evidence } as Prisma.InputJsonValue,
          extractionConfidence: fields.confidence,
        },
      });
    } else {
      await input.prisma.bidQuoteStaging.create({
        data: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          emailMessageId: email.id,
          sourceSubject: email.subject,
          extractedScope: fields.scope,
          extractedAmount: fields.amount,
          currency: fields.currency,
          extractedNotes: fields.notes,
          extractionEvidence: { labels: fields.evidence } as Prisma.InputJsonValue,
          extractionConfidence: fields.confidence,
          matchStatus: "UNMATCHED",
        },
      });
    }
    extracted += 1;
  }

  input.progress.quotesExtracted = extracted;
  await writeProgress(input.prisma, input.runId, input.progress);
}

/** Match BidQuoteStaging → BidCandidates (and BidCandidateEmail links). */
export async function matchQuotesToCandidates(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
}): Promise<void> {
  input.progress.currentPhase = "MATCHING_QUOTES";
  await writeProgress(input.prisma, input.runId, input.progress);

  const quotes = await input.prisma.bidQuoteStaging.findMany({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
    },
    include: {
      emailMessage: {
        select: {
          id: true,
          subject: true,
          bodyText: true,
          senderName: true,
          attachmentMetadata: true,
          jobId: true,
        },
      },
    },
  });

  const openCandidates = await input.prisma.bidCandidate.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: { in: ["DISCOVERED", "READY", "NEEDS_REVIEW"] },
    },
    select: {
      id: true,
      proposedProjectName: true,
      proposedJobNumber: true,
      proposedCustomerName: true,
    },
    take: 300,
  });

  let matched = 0;
  let unmatched = 0;
  let needsReview = 0;

  for (const q of quotes) {
    if (q.userConfirmedMatch) {
      if (q.matchStatus === "MATCHED") matched += 1;
      else if (q.matchStatus === "NEEDS_REVIEW" || q.matchStatus === "POSSIBLE_MATCH")
        needsReview += 1;
      else unmatched += 1;
      continue;
    }

    const inviteFields = extractInviteFields(q.emailMessage);

    let best: { id: string; score: number; evidence: string[] } | null = null;
    for (const c of openCandidates) {
      const scored = scoreQuoteToBidCandidate({
        quoteProjectName: inviteFields.projectName,
        quoteProjectNumber: inviteFields.projectNumber,
        quoteCustomerName: inviteFields.customerName,
        quoteSubject: q.emailMessage.subject,
        quoteAttachmentNames: inviteFields.attachmentNames,
        candidate: c,
      });
      if (!best || scored.score > best.score) {
        best = { id: c.id, score: scored.score, evidence: scored.evidence };
      }
    }

    if (best && best.score >= QUOTE_AUTO_LINK_THRESHOLD) {
      await input.prisma.bidQuoteStaging.update({
        where: { id: q.id },
        data: {
          bidCandidateId: best.id,
          matchStatus: "MATCHED",
          matchConfidence: best.score,
          matchEvidence: { labels: best.evidence },
        },
      });
      await input.prisma.bidCandidateEmail.upsert({
        where: {
          bidCandidateId_emailMessageId: {
            bidCandidateId: best.id,
            emailMessageId: q.emailMessageId,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          bidCandidateId: best.id,
          emailMessageId: q.emailMessageId,
          role: "QUOTE",
          matchConfidence: best.score,
          matchEvidence: { labels: best.evidence },
        },
        update: {
          matchConfidence: best.score,
          matchEvidence: { labels: best.evidence },
        },
      });
      matched += 1;
    } else if (best && best.score >= QUOTE_REVIEW_THRESHOLD) {
      await input.prisma.bidQuoteStaging.update({
        where: { id: q.id },
        data: {
          bidCandidateId: best.id,
          matchStatus: "NEEDS_REVIEW",
          matchConfidence: best.score,
          matchEvidence: { labels: best.evidence, needsReview: true },
        },
      });
      await input.prisma.bidCandidate.update({
        where: { id: best.id },
        data: { status: "NEEDS_REVIEW" },
      });
      needsReview += 1;
    } else {
      await input.prisma.bidQuoteStaging.update({
        where: { id: q.id },
        data: {
          bidCandidateId: null,
          matchStatus: "UNMATCHED",
          matchConfidence: best?.score ?? null,
          matchEvidence: best
            ? { labels: best.evidence, bestCandidateId: best.id }
            : Prisma.JsonNull,
        },
      });
      unmatched += 1;
    }
  }

  input.progress.quotesMatched = matched;
  input.progress.quotesUnmatched = unmatched;
  input.progress.quotesNeedsReview = needsReview;
  await writeProgress(input.prisma, input.runId, input.progress);
}

/**
 * Propose existing Job matches for open candidates via JobMatcher (staging only).
 * Does NOT call persistJobMatchResult / write EmailMessage.jobId.
 */
export async function matchExistingJobsForCandidates(input: {
  prisma: PrismaClient;
  workspaceId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
}): Promise<void> {
  input.progress.currentPhase = "MATCHING_EXISTING_JOBS";
  await writeProgress(input.prisma, input.runId, input.progress);

  const candidates = await input.prisma.bidCandidate.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: { in: ["DISCOVERED", "READY", "NEEDS_REVIEW"] },
      // Do not overwrite user resolutions.
      existingJobMatchStatus: {
        notIn: ["RESOLVED_SAME", "RESOLVED_DIFFERENT"],
      },
    },
    select: {
      id: true,
      proposedProjectName: true,
      proposedCustomerName: true,
      proposedJobNumber: true,
      proposedBidDueAt: true,
      status: true,
      emails: {
        where: { isPrimary: true },
        take: 1,
        select: {
          emailMessage: {
            select: {
              subject: true,
              bodyText: true,
              senderEmail: true,
              threadId: true,
            },
          },
        },
      },
    },
    take: 300,
  });

  const loader = createPrismaJobMatchLoader(input.prisma);
  const [jobs, aliases] = await Promise.all([
    loader.loadActiveJobs(input.workspaceId),
    loader.loadJobAliases(input.workspaceId),
  ]);

  let strong = 0;
  let possible = 0;
  let none = 0;

  for (const c of candidates) {
    const primary = c.emails[0]?.emailMessage;
    const subject =
      primary?.subject ??
      [c.proposedJobNumber, c.proposedProjectName, c.proposedCustomerName]
        .filter(Boolean)
        .join(" ");
    const bodyText =
      primary?.bodyText ??
      `Project: ${c.proposedProjectName ?? ""}\nCustomer: ${c.proposedCustomerName ?? ""}\nJob #: ${c.proposedJobNumber ?? ""}`;
    const senderEmail = primary?.senderEmail ?? null;
    const [senderCustomerJobIds, threadJobId] = await Promise.all([
      loader.loadSenderCustomerJobIds(input.workspaceId, senderEmail),
      loader.loadThreadJobHint(input.workspaceId, primary?.threadId ?? null),
    ]);

    const ranked = rankJobMatchCandidates({
      subject,
      bodyText,
      senderDomain: senderEmail ? extractDomain(senderEmail) : null,
      jobs,
      aliases,
      threadJobId,
      senderCustomerJobIds,
      limit: 5,
    });

    const top = ranked[0];
    const second = ranked[1];
    let status: "NONE" | "POSSIBLE" | "STRONG" | "NEEDS_REVIEW" = "NONE";
    let proposedExistingJobId: string | null = null;
    let confidence: number | null = null;
    let evidence: unknown = null;

    if (top && top.score >= 0.9 && (!second || top.score - second.score >= 0.12)) {
      status = "STRONG";
      proposedExistingJobId = top.jobId;
      confidence = top.score;
      evidence = { labels: top.evidence.map((e) => e.type), score: top.score };
      strong += 1;
    } else if (top && top.score >= 0.7) {
      status =
        second && top.score - second.score < 0.12 ? "NEEDS_REVIEW" : "POSSIBLE";
      proposedExistingJobId = top.jobId;
      confidence = top.score;
      evidence = {
        labels: top.evidence.map((e) => e.type),
        score: top.score,
        runnerUpJobId: second?.jobId ?? null,
      };
      possible += 1;
    } else {
      none += 1;
    }

    const nextStatus =
      status === "NONE" || status === "POSSIBLE"
        ? c.status === "NEEDS_REVIEW"
          ? "NEEDS_REVIEW"
          : c.proposedProjectName && c.proposedBidDueAt
            ? "READY"
            : c.status
        : "NEEDS_REVIEW";

    await input.prisma.bidCandidate.update({
      where: { id: c.id },
      data: {
        proposedExistingJobId,
        existingJobMatchStatus: status,
        existingJobMatchConfidence: confidence,
        existingJobMatchEvidence: evidence as Prisma.InputJsonValue,
        status: nextStatus,
        importBlockedReason: computeImportBlockedReason({
          status: nextStatus,
          proposedProjectName: c.proposedProjectName,
          existingJobMatchStatus: status,
        }),
      },
    });
  }

  input.progress.existingJobsStrong = strong;
  input.progress.existingJobsPossible = possible;
  input.progress.existingJobsNone = none;
  await writeProgress(input.prisma, input.runId, input.progress);
}

/** Full staging analysis after discovery (no Graph, no Jobs). */
export async function runBidStagingPipeline(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
}): Promise<void> {
  await extractBidCandidatesFromDiscovery(input);
  await extractQuotesFromDiscovery(input);
  await matchQuotesToCandidates(input);
  await matchExistingJobsForCandidates({
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    runId: input.runId,
    progress: input.progress,
  });
  input.progress.currentPhase = "READY_FOR_REVIEW";
  await writeProgress(input.prisma, input.runId, input.progress);
}
