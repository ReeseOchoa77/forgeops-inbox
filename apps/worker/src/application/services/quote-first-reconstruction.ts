/**
 * Quote-first Bid reconstruction: Quotes define the population; Bid Invites /
 * Inbox supply the original Bid email. NEVER creates Jobs.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  BID_INVITE_LOOKBACK_DAYS,
  ORIGINAL_BID_AUTO_MATCH_THRESHOLD,
  ORIGINAL_BID_REVIEW_THRESHOLD,
  buildBidCandidateIdentityKey,
  buildQuoteProjectGroupKey,
  emptyDetailedScope,
  extractBidDueDateDeterministic,
  extractDetailedScopeDeterministic,
  isDetailedScopeComplete,
  isTrustworthyBiddingProjectNumber,
  isUserConfirmedBidCandidateEmail,
  quoteGroupKeyBasisLabel,
  quoteMatchNeedsAiAdjudication,
  resolveBidInviteSearchSinceAt,
  resolveBidProjectIdentity,
  scopeSummaryString,
  scoreEmailToQuoteProject,
  suggestBidProjectNameFromSubject,
  type BidEmailAnalyzeProgress,
  type DetailedScope,
} from "@forgeops/shared";

import {
  bumpAiCalls,
  inviteEmailRoleFromSubject,
  type BidStagingAiContext,
} from "./bid-staging-ai-context.js";

function lockedFields(userEditedFields: unknown): Set<string> {
  if (!Array.isArray(userEditedFields)) return new Set();
  return new Set(
    userEditedFields.filter((k): k is string => typeof k === "string")
  );
}

function evidenceObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function filenamesFromMetadata(attachmentMetadata: unknown): string[] {
  const filenames: string[] = [];
  if (Array.isArray(attachmentMetadata)) {
    for (const a of attachmentMetadata) {
      if (
        a &&
        typeof a === "object" &&
        typeof (a as { filename?: unknown }).filename === "string"
      ) {
        filenames.push((a as { filename: string }).filename);
      }
    }
  }
  return filenames;
}

export function computeImportBlockedReasonQuoteFirst(c: {
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

function markStageMs(
  progress: BidEmailAnalyzeProgress,
  stage: string,
  started: number
): void {
  const timings = progress.stageTimingsMs ?? {};
  timings[stage] = (timings[stage] ?? 0) + (Date.now() - started);
  progress.stageTimingsMs = timings;
}

export type QuoteProjectGroup = {
  groupKey: string;
  projectName: string | null;
  projectNumber: string | null;
  customerName: string | null;
  quoteRows: Array<{
    stagingId: string;
    emailMessageId: string;
    subject: string | null;
    bodyText: string | null;
    senderName: string | null;
    attachmentMetadata: unknown;
    receivedAt: Date | null;
    displayName: string | null;
    extractedScope: string | null;
    extractedScopeDetail: unknown;
    extractedAmount: unknown;
    extractedNotes: string | null;
    userConfirmedMatch: boolean;
    userEditedFields: unknown;
    matchStatus: string;
  }>;
};

function quoteIdentityFromEmail(msg: {
  subject: string | null;
  bodyText: string | null;
  senderName: string | null;
  attachmentMetadata: unknown;
}): {
  projectName: string | null;
  projectNumber: string | null;
  customerName: string | null;
  attachmentNames: string[];
} {
  const filenames = filenamesFromMetadata(msg.attachmentMetadata);
  const identity = resolveBidProjectIdentity({
    subject: msg.subject,
    bodyText: msg.bodyText,
    pdfFilenames: filenames,
    customerCompanyName: null,
  });
  const projectName =
    identity.projectName ?? suggestBidProjectNameFromSubject(msg.subject);
  // Bare subject digits only when distinctive enough for identity (not PR-01 → 01).
  const bareNumber = (msg.subject ?? "").match(/\b(\d{2,6})\b/)?.[1] ?? null;
  const projectNumber =
    bareNumber && isTrustworthyBiddingProjectNumber(bareNumber)
      ? bareNumber
      : null;
  return {
    projectName,
    projectNumber,
    customerName: msg.senderName?.trim() || null,
    attachmentNames: filenames,
  };
}

/** Cluster Quote stagings into project groups (revisions stay separate rows). */
export async function groupQuotesIntoProjects(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
}): Promise<QuoteProjectGroup[]> {
  const stageStarted = Date.now();
  input.progress.currentPhase = "GROUPING_QUOTES";
  await writeProgress(input.prisma, input.runId, input.progress);

  const quotes = await input.prisma.bidQuoteStaging.findMany({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      matchStatus: { not: "REJECTED" },
    },
    include: {
      emailMessage: {
        select: {
          id: true,
          subject: true,
          bodyText: true,
          senderName: true,
          attachmentMetadata: true,
          receivedAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, QuoteProjectGroup>();

  for (const q of quotes) {
    const id = quoteIdentityFromEmail(q.emailMessage);
    const groupKey = buildQuoteProjectGroupKey({
      projectNumber: id.projectNumber,
      projectName: id.projectName ?? q.displayName ?? q.emailMessage.subject,
      customerName: id.customerName,
      fallbackMessageId: q.emailMessageId,
    });
    if (!groupKey) continue;

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        projectName: id.projectName ?? q.displayName,
        projectNumber: id.projectNumber,
        customerName: id.customerName,
        quoteRows: [],
      };
      groups.set(groupKey, group);
    } else {
      if (!group.projectName && id.projectName) group.projectName = id.projectName;
      if (!group.projectNumber && id.projectNumber)
        group.projectNumber = id.projectNumber;
      if (!group.customerName && id.customerName)
        group.customerName = id.customerName;
    }

    group.quoteRows.push({
      stagingId: q.id,
      emailMessageId: q.emailMessageId,
      subject: q.emailMessage.subject,
      bodyText: q.emailMessage.bodyText,
      senderName: q.emailMessage.senderName,
      attachmentMetadata: q.emailMessage.attachmentMetadata,
      receivedAt: q.emailMessage.receivedAt,
      displayName: q.displayName,
      extractedScope: q.extractedScope,
      extractedScopeDetail: q.extractedScopeDetail,
      extractedAmount: q.extractedAmount,
      extractedNotes: q.extractedNotes,
      userConfirmedMatch: q.userConfirmedMatch,
      userEditedFields: q.userEditedFields,
      matchStatus: q.matchStatus,
    });
  }

  const list = [...groups.values()];
  input.progress.quoteProjectsIdentified = list.length;
  markStageMs(input.progress, "GROUPING_QUOTES", stageStarted);
  await writeProgress(input.prisma, input.runId, input.progress);
  return list;
}

type ScoredEmail = {
  emailMessageId: string;
  score: number;
  evidence: string[];
  subject: string | null;
  bodyText: string | null;
  senderName: string | null;
  senderEmail: string | null;
  threadId: string | null;
  attachmentMetadata: unknown;
  receivedAt: Date | null;
};

async function loadInvitePool(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
}): Promise<ScoredEmail[]> {
  const inviteIds = (
    await input.prisma.bidFolderDiscoveryEmail.findMany({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        role: "BID_INVITE",
      },
      select: { emailMessageId: true },
    })
  ).map((d) => d.emailMessageId);

  if (inviteIds.length === 0) return [];

  const emails = await input.prisma.emailMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      id: { in: inviteIds },
    },
    select: {
      id: true,
      subject: true,
      bodyText: true,
      senderName: true,
      senderEmail: true,
      threadId: true,
      attachmentMetadata: true,
      receivedAt: true,
      snippet: true,
    },
  });

  return emails.map((e) => ({
    emailMessageId: e.id,
    score: 0,
    evidence: [],
    subject: e.subject,
    bodyText: e.bodyText ?? e.snippet,
    senderName: e.senderName,
    senderEmail: e.senderEmail,
    threadId: e.threadId,
    attachmentMetadata: e.attachmentMetadata,
    receivedAt: e.receivedAt,
  }));
}

function scorePoolAgainstGroup(
  pool: ScoredEmail[],
  group: QuoteProjectGroup
): ScoredEmail[] {
  const quoteSubject = group.quoteRows[0]?.subject ?? null;
  return pool
    .map((e) => {
      const scored = scoreEmailToQuoteProject({
        emailSubject: e.subject,
        emailBodySnippet: e.bodyText,
        emailSenderName: e.senderName,
        quoteProjectName: group.projectName,
        quoteProjectNumber: group.projectNumber,
        quoteCustomerName: group.customerName,
        quoteSubject,
      });
      return { ...e, score: scored.score, evidence: scored.evidence };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function maybeAdjudicateInviteShortlist(input: {
  ai?: BidStagingAiContext | null;
  progress: BidEmailAnalyzeProgress;
  group: QuoteProjectGroup;
  scored: ScoredEmail[];
}): Promise<ScoredEmail | null> {
  const best = input.scored[0] ?? null;
  const second = input.scored[1] ?? null;
  if (!best) return null;

  if (
    !quoteMatchNeedsAiAdjudication({
      bestScore: best.score,
      secondScore: second?.score ?? null,
      autoLinkThreshold: ORIGINAL_BID_AUTO_MATCH_THRESHOLD,
      reviewThreshold: ORIGINAL_BID_REVIEW_THRESHOLD,
    }) ||
    !input.ai?.quoteMatchAdjudicator.isConfigured()
  ) {
    if (best.score >= ORIGINAL_BID_AUTO_MATCH_THRESHOLD) return best;
    return null;
  }

  try {
    const shortlist = input.scored.slice(0, 5).map((s) => ({
      id: s.emailMessageId,
      projectName: s.subject,
      jobNumber: null as string | null,
      customerName: s.senderName,
      score: s.score,
      evidence: s.evidence,
    }));
    const adj = await input.ai.quoteMatchAdjudicator.adjudicate({
      quote: {
        subject: input.group.quoteRows[0]?.subject ?? null,
        scope: input.group.quoteRows[0]?.extractedScope ?? null,
        amount:
          input.group.quoteRows[0]?.extractedAmount != null
            ? Number(input.group.quoteRows[0].extractedAmount)
            : null,
        projectHints: [input.group.projectName, input.group.projectNumber].filter(
          Boolean
        ) as string[],
        attachmentNames: filenamesFromMetadata(
          input.group.quoteRows[0]?.attachmentMetadata
        ),
      },
      shortlist,
    });
    bumpAiCalls(input.progress, "original_bid_match_adjudicate");
    if (adj.decision === "MATCH" && adj.bestCandidateId) {
      const picked = input.scored.find(
        (s) => s.emailMessageId === adj.bestCandidateId
      );
      if (picked && picked.score >= ORIGINAL_BID_REVIEW_THRESHOLD) {
        return {
          ...picked,
          // AI may only elevate to review-safe auto when already strong enough;
          // keep below auto if weak — human confirms.
          score: Math.min(
            ORIGINAL_BID_AUTO_MATCH_THRESHOLD - 0.01,
            Math.max(picked.score, adj.confidence ?? picked.score)
          ),
          evidence: [
            ...picked.evidence,
            `ai_adjudication:${adj.decision}`,
            "ai_original_bid",
          ],
        };
      }
    }
  } catch {
    /* AI optional — fall through */
  }

  if (best.score >= ORIGINAL_BID_AUTO_MATCH_THRESHOLD) return best;
  return null;
}

async function searchInboxFallback(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  group: QuoteProjectGroup;
  excludeEmailIds: Set<string>;
}): Promise<ScoredEmail | null> {
  const earliestQuote =
    input.group.quoteRows
      .map((q) => q.receivedAt?.getTime() ?? 0)
      .filter((t) => t > 0)
      .sort((a, b) => a - b)[0] ?? Date.now();
  const quoteDate = new Date(earliestQuote);
  const since =
    resolveBidInviteSearchSinceAt(quoteDate) ??
    new Date(
      quoteDate.getTime() - BID_INVITE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    );

  const nameTokens = (input.group.projectName ?? "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .slice(0, 4);

  if (!input.group.projectNumber && nameTokens.length === 0) {
    return null;
  }

  const orFilters: Prisma.EmailMessageWhereInput[] = [];
  if (input.group.projectNumber) {
    orFilters.push({
      subject: { contains: input.group.projectNumber, mode: "insensitive" },
    });
  }
  for (const tok of nameTokens) {
    orFilters.push({ subject: { contains: tok, mode: "insensitive" } });
  }
  if (orFilters.length === 0) return null;

  const discoveredIds = (
    await input.prisma.bidFolderDiscoveryEmail.findMany({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
      },
      select: { emailMessageId: true },
    })
  ).map((d) => d.emailMessageId);

  const exclude = new Set([
    ...input.excludeEmailIds,
    ...discoveredIds,
    ...input.group.quoteRows.map((q) => q.emailMessageId),
  ]);

  const candidates = await input.prisma.emailMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      id: { notIn: [...exclude].slice(0, 500) },
      receivedAt: { gte: since, lte: quoteDate },
      OR: orFilters,
    },
    select: {
      id: true,
      subject: true,
      bodyText: true,
      snippet: true,
      senderName: true,
      senderEmail: true,
      threadId: true,
      attachmentMetadata: true,
      receivedAt: true,
    },
    take: 40,
    orderBy: { receivedAt: "desc" },
  });

  const scored = candidates
    .map((e) => {
      const s = scoreEmailToQuoteProject({
        emailSubject: e.subject,
        emailBodySnippet: e.bodyText ?? e.snippet,
        emailSenderName: e.senderName,
        quoteProjectName: input.group.projectName,
        quoteProjectNumber: input.group.projectNumber,
        quoteCustomerName: input.group.customerName,
        quoteSubject: input.group.quoteRows[0]?.subject ?? null,
      });
      return {
        emailMessageId: e.id,
        score: s.score,
        evidence: [...s.evidence, "inbox_fallback"],
        subject: e.subject,
        bodyText: e.bodyText ?? e.snippet,
        senderName: e.senderName,
        senderEmail: e.senderEmail,
        threadId: e.threadId,
        attachmentMetadata: e.attachmentMetadata,
        receivedAt: e.receivedAt,
      };
    })
    .filter((e) => e.score >= ORIGINAL_BID_AUTO_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  return scored[0] ?? null;
}

async function linkSupportingThreadEmails(input: {
  prisma: PrismaClient;
  workspaceId: string;
  candidateId: string;
  primaryEmailId: string;
  threadId: string | null;
  invitePoolIds: Set<string>;
}): Promise<void> {
  if (!input.threadId) return;
  const siblings = await input.prisma.emailMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      id: { not: input.primaryEmailId },
    },
    select: { id: true, subject: true },
    take: 20,
  });
  for (const sib of siblings) {
    if (!input.invitePoolIds.has(sib.id)) continue;
    const role = inviteEmailRoleFromSubject(sib.subject);
    if (role === "BID_INVITE") continue;
    await input.prisma.bidCandidateEmail.upsert({
      where: {
        bidCandidateId_emailMessageId: {
          bidCandidateId: input.candidateId,
          emailMessageId: sib.id,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        bidCandidateId: input.candidateId,
        emailMessageId: sib.id,
        role,
        isPrimary: false,
      },
      update: role === "ADDENDUM" ? { role: "ADDENDUM" } : {},
    });
  }
}

/**
 * Build BidCandidates from Quote groups + matched original Bid evidence.
 */
export async function reconstructCandidatesFromQuoteGroups(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
  ai?: BidStagingAiContext | null;
  groups: QuoteProjectGroup[];
}): Promise<void> {
  const searchStarted = Date.now();
  input.progress.currentPhase = "SEARCHING_BID_INVITES";
  await writeProgress(input.prisma, input.runId, input.progress);

  const invitePool = await loadInvitePool({
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
  });
  const invitePoolIds = new Set(invitePool.map((e) => e.emailMessageId));

  markStageMs(input.progress, "SEARCHING_BID_INVITES", searchStarted);

  let fromInvites = 0;
  let fromInbox = 0;
  let notFound = 0;
  let matchedQuotes = 0;

  input.progress.currentPhase = "MATCHING_BID_INVITES";
  await writeProgress(input.prisma, input.runId, input.progress);
  const matchStarted = Date.now();

  for (const group of input.groups) {
    const scoredInvites = scorePoolAgainstGroup(invitePool, group);
    let original: ScoredEmail | null = await maybeAdjudicateInviteShortlist({
      ...(input.ai !== undefined ? { ai: input.ai } : {}),
      progress: input.progress,
      group,
      scored: scoredInvites,
    });
    let source: "NONE" | "BID_INVITES_FOLDER" | "INBOX_FALLBACK" = "NONE";

    if (original) {
      source = "BID_INVITES_FOLDER";
      fromInvites += 1;
    } else {
      input.progress.currentPhase = "SEARCHING_INBOX_FALLBACK";
      const inboxHit = await searchInboxFallback({
        prisma: input.prisma,
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        group,
        excludeEmailIds: invitePoolIds,
      });
      if (inboxHit) {
        original = inboxHit;
        source = "INBOX_FALLBACK";
        fromInbox += 1;
      } else {
        notFound += 1;
      }
    }

    input.progress.currentPhase = "BUILDING_CANDIDATES";

    // Prefer Bid email for due date / customer; Quote for scope/amount display.
    let bidDueAt: Date | null = null;
    let projectName = group.projectName;
    let projectNumber = group.projectNumber;
    let customerName = group.customerName;
    let scopeDetail: DetailedScope = emptyDetailedScope();
    let scopeSummary: string | null = null;
    let notes: string | null = null;

    if (original) {
      const dueYmd = extractBidDueDateDeterministic({
        subject: original.subject,
        bodyText: original.bodyText,
      });
      bidDueAt = dueYmd ? new Date(`${dueYmd}T00:00:00.000Z`) : null;
      const inviteId = quoteIdentityFromEmail({
        subject: original.subject,
        bodyText: original.bodyText,
        senderName: original.senderName,
        attachmentMetadata: original.attachmentMetadata,
      });
      projectName = inviteId.projectName ?? projectName;
      projectNumber = inviteId.projectNumber ?? projectNumber;
      customerName = inviteId.customerName ?? customerName;
      scopeDetail = extractDetailedScopeDeterministic({
        subject: original.subject,
        bodyText: original.bodyText,
        attachmentNames: inviteId.attachmentNames,
        pdfText: null,
      });
      scopeSummary = scopeSummaryString(scopeDetail);
    }

    // Supplement scope from Quote evidence when invite scope incomplete.
    for (const qr of group.quoteRows) {
      const qd = qr.extractedScopeDetail as DetailedScope | null;
      if (qd && isDetailedScopeComplete(qd)) {
        scopeDetail = qd;
        scopeSummary = scopeSummaryString(qd) ?? qr.extractedScope;
        break;
      }
      if (!scopeSummary && qr.extractedScope) {
        scopeSummary = qr.extractedScope;
      }
      if (!notes && qr.extractedNotes) notes = qr.extractedNotes;
    }

    // Email-extracted number is external project/bid evidence — not a ForgeOps Job #.
    const identityKey =
      buildBidCandidateIdentityKey({
        externalProjectNumber: projectNumber,
        projectName,
        customerName,
        fallbackMessageId: group.quoteRows[0]?.emailMessageId ?? null,
      }) ?? group.groupKey;

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
        lifecycle: true,
        userEditedFields: true,
        proposedProjectName: true,
        proposedCustomerName: true,
        customerId: true,
        proposedBidDueAt: true,
        anticipatedStartAt: true,
        proposedJobNumber: true,
        proposedScope: true,
        proposedScopeDetail: true,
        proposedNotes: true,
        existingJobMatchStatus: true,
        evidence: true,
        originalBidSource: true,
      },
    });

    const needsReviewNoBid = source === "NONE";
    const hasQuotes = group.quoteRows.some((q) => q.matchStatus !== "REJECTED");
    let candidateId: string;

    if (existing) {
      candidateId = existing.id;
      // Never mutate converted Candidates; preserve user lifecycle/customer/start.
      if (
        existing.status !== "CONFIRMED" &&
        existing.status !== "REJECTED" &&
        existing.lifecycle !== "CONVERTED"
      ) {
        const locked = lockedFields(existing.userEditedFields);
        const nextName = locked.has("proposedProjectName")
          ? existing.proposedProjectName
          : projectName ?? existing.proposedProjectName;
        const nextCustomer = locked.has("proposedCustomerName")
          ? existing.proposedCustomerName
          : customerName ?? existing.proposedCustomerName;
        const nextDue = locked.has("proposedBidDueAt")
          ? existing.proposedBidDueAt
          : bidDueAt ?? existing.proposedBidDueAt;
        // proposedJobNumber stores external evidence only — never generate Job #s.
        const nextNumber = locked.has("proposedJobNumber")
          ? existing.proposedJobNumber
          : projectNumber ?? existing.proposedJobNumber;
        const scopeLocked =
          locked.has("proposedScope") || locked.has("proposedScopeDetail");
        const status =
          needsReviewNoBid || !nextName
            ? "NEEDS_REVIEW"
            : nextName && nextDue
              ? "READY"
              : "DISCOVERED";
        let nextLifecycle = existing.lifecycle;
        if (!locked.has("lifecycle")) {
          if (hasQuotes && existing.lifecycle === "OPEN") {
            nextLifecycle = "QUOTED";
          }
        }
        const prevEv = evidenceObject(existing.evidence);
        await input.prisma.bidCandidate.update({
          where: { id: existing.id },
          data: {
            proposedProjectName: nextName,
            proposedCustomerName: nextCustomer,
            // Preserve resolved customer + start date always when set/locked.
            customerId: locked.has("customerId")
              ? existing.customerId
              : existing.customerId,
            anticipatedStartAt: locked.has("anticipatedStartAt")
              ? existing.anticipatedStartAt
              : existing.anticipatedStartAt,
            proposedBidDueAt: nextDue,
            proposedJobNumber: nextNumber,
            proposedScope: scopeLocked
              ? existing.proposedScope
              : scopeSummary ?? existing.proposedScope,
            proposedScopeDetail: scopeLocked
              ? (existing.proposedScopeDetail as Prisma.InputJsonValue)
              : (scopeDetail as unknown as Prisma.InputJsonValue),
            proposedNotes: locked.has("proposedNotes")
              ? existing.proposedNotes
              : notes ?? existing.proposedNotes,
            lifecycle: nextLifecycle,
            originalBidSource: source,
            evidence: {
              ...prevEv,
              quoteFirst: true,
              quoteGroupKey: group.groupKey,
              originalBidSource: source,
              originalBidEvidence: original?.evidence ?? [],
              originalBidNotFound: needsReviewNoBid || undefined,
            } as Prisma.InputJsonValue,
            status,
            confidence: needsReviewNoBid ? 0.4 : 0.75,
            importBlockedReason: computeImportBlockedReasonQuoteFirst({
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
        needsReviewNoBid || !projectName
          ? "NEEDS_REVIEW"
          : projectName && bidDueAt
            ? "READY"
            : "DISCOVERED";
      const created = await input.prisma.bidCandidate.create({
        data: {
          workspaceId: input.workspaceId,
          identityKey,
          lifecycle: hasQuotes ? "QUOTED" : "OPEN",
          proposedProjectName: projectName,
          proposedCustomerName: customerName,
          proposedBidDueAt: bidDueAt,
          // External project/bid evidence only — not a ForgeOps Job number.
          proposedJobNumber: projectNumber,
          proposedScope: scopeSummary,
          proposedScopeDetail: scopeDetail as unknown as Prisma.InputJsonValue,
          proposedNotes: notes,
          originalBidSource: source,
          evidence: {
            quoteFirst: true,
            quoteGroupKey: group.groupKey,
            originalBidSource: source,
            originalBidEvidence: original?.evidence ?? [],
            originalBidNotFound: needsReviewNoBid || undefined,
          } as Prisma.InputJsonValue,
          status,
          confidence: needsReviewNoBid ? 0.4 : 0.75,
          importBlockedReason: computeImportBlockedReasonQuoteFirst({
            status,
            proposedProjectName: projectName,
            existingJobMatchStatus: "NONE",
          }),
        },
      });
      candidateId = created.id;
      input.progress.candidatesCreated += 1;
    }

    if (original) {
      // Manual Inbox association is authoritative — never re-home the email.
      const priorLinks = await input.prisma.bidCandidateEmail.findMany({
        where: {
          workspaceId: input.workspaceId,
          emailMessageId: original.emailMessageId,
        },
        select: { bidCandidateId: true, matchEvidence: true },
      });
      const userLocked = priorLinks.find((l) =>
        isUserConfirmedBidCandidateEmail(l.matchEvidence)
      );
      if (!userLocked || userLocked.bidCandidateId === candidateId) {
        const role = inviteEmailRoleFromSubject(original.subject);
        await input.prisma.bidCandidateEmail.upsert({
          where: {
            bidCandidateId_emailMessageId: {
              bidCandidateId: candidateId,
              emailMessageId: original.emailMessageId,
            },
          },
          create: {
            workspaceId: input.workspaceId,
            bidCandidateId: candidateId,
            emailMessageId: original.emailMessageId,
            role: role === "ADDENDUM" ? "BID_INVITE" : role,
            isPrimary: true,
            matchConfidence: original.score,
            matchEvidence: {
              labels: original.evidence,
              source,
            } as Prisma.InputJsonValue,
          },
          update: userLocked
            ? {}
            : {
                isPrimary: true,
                matchConfidence: original.score,
                matchEvidence: {
                  labels: original.evidence,
                  source,
                } as Prisma.InputJsonValue,
              },
        });
        await linkSupportingThreadEmails({
          prisma: input.prisma,
          workspaceId: input.workspaceId,
          candidateId,
          primaryEmailId: original.emailMessageId,
          threadId: original.threadId,
          invitePoolIds,
        });
      }
    }

    for (const qr of group.quoteRows) {
      if (qr.matchStatus === "REJECTED") continue;
      if (qr.userConfirmedMatch && qr.matchStatus !== "MATCHED") {
        // Preserve explicit user unmatch / review decisions.
        continue;
      }
      // Manual Inbox Quote association is authoritative — never re-home.
      const priorQuoteLinks = await input.prisma.bidCandidateEmail.findMany({
        where: {
          workspaceId: input.workspaceId,
          emailMessageId: qr.emailMessageId,
          role: "QUOTE",
        },
        select: { bidCandidateId: true, matchEvidence: true },
      });
      const quoteUserLocked = priorQuoteLinks.find((l) =>
        isUserConfirmedBidCandidateEmail(l.matchEvidence)
      );
      if (quoteUserLocked && quoteUserLocked.bidCandidateId !== candidateId) {
        continue;
      }

      await input.prisma.bidQuoteStaging.update({
        where: { id: qr.stagingId },
        data: {
          bidCandidateId: candidateId,
          matchStatus: "MATCHED",
          matchConfidence: 0.9,
          isDurable: true,
          matchEvidence: {
            labels: [
              "quote_first_group",
              group.groupKey,
              quoteGroupKeyBasisLabel(group.groupKey),
            ],
            quoteFirst: true,
          } as Prisma.InputJsonValue,
        },
      });
      await input.prisma.bidCandidateEmail.upsert({
        where: {
          bidCandidateId_emailMessageId: {
            bidCandidateId: candidateId,
            emailMessageId: qr.emailMessageId,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          bidCandidateId: candidateId,
          emailMessageId: qr.emailMessageId,
          role: "QUOTE",
          matchConfidence: 0.9,
          matchEvidence: {
            labels: [
              "quote_first_group",
              group.groupKey,
              quoteGroupKeyBasisLabel(group.groupKey),
            ],
          },
          isPrimary: false,
        },
        update: quoteUserLocked
          ? {}
          : {
              matchConfidence: 0.9,
              matchEvidence: {
                labels: [
                  "quote_first_group",
                  group.groupKey,
                  quoteGroupKeyBasisLabel(group.groupKey),
                ],
              },
            },
      });
      matchedQuotes += 1;
    }
  }

  markStageMs(input.progress, "MATCHING_BID_INVITES", matchStarted);
  markStageMs(input.progress, "BUILDING_CANDIDATES", matchStarted);

  input.progress.originalBidFromInvites = fromInvites;
  input.progress.originalBidFromInbox = fromInbox;
  input.progress.originalBidNotFound = notFound;
  input.progress.quotesMatched = matchedQuotes;
  input.progress.quotesUnmatched = 0;
  input.progress.quotesNeedsReview = notFound;
  await writeProgress(input.prisma, input.runId, input.progress);
}
