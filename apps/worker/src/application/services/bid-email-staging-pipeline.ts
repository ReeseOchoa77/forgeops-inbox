/**
 * Staging-only Bid Candidate / Quote extract + match + existing-Job proposal.
 * NEVER creates Jobs. NEVER writes EmailMessage.jobId.
 *
 * Pipeline: deterministic extract → optional AI when incomplete/ambiguous → human review.
 * AI failures never fail Scan Bids.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  bidFieldsNeedAiEnrichment,
  buildBidCandidateIdentityKey,
  extractBidDueDateDeterministic,
  extractDetailedScopeDeterministic,
  extractDomain,
  extractQuoteFieldsDeterministic,
  existingJobNeedsAiAdjudication,
  isDetailedScopeComplete,
  mergeAiScopeDetail,
  quoteFieldsNeedAiEnrichment,
  quoteMatchNeedsAiAdjudication,
  rankJobMatchCandidates,
  resolveBidProjectIdentity,
  scopeSummaryString,
  scoreQuoteToBidCandidate,
  suggestBidProjectNameFromSubject,
  QUOTE_AUTO_LINK_THRESHOLD,
  QUOTE_REVIEW_THRESHOLD,
  type BidEmailAnalyzeProgress,
  type DetailedScope,
} from "@forgeops/shared";

import {
  ensureEmailAttachmentTexts,
  mergeAttachmentPdfTexts,
} from "./attachment-text-extract.js";
import {
  bumpAiCalls,
  createBidStagingAiContext,
  inviteEmailRoleFromSubject,
  type BidStagingAiContext,
} from "./bid-staging-ai-context.js";
import { createPrismaJobMatchLoader } from "./prisma-job-match-loader.js";
import {
  groupQuotesIntoProjects,
  reconstructCandidatesFromQuoteGroups,
} from "./quote-first-reconstruction.js";

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
    fieldSources: {
      proposedProjectName: projectName
        ? identity.projectName
          ? "DETERMINISTIC"
          : "EMAIL_SUBJECT"
        : null,
      proposedCustomerName: msg.senderName?.trim() ? "EMAIL_SENDER" : null,
      proposedBidDueAt: dueYmd ? "DETERMINISTIC" : null,
      proposedJobNumber: jobNumberMatch ? "EMAIL_SUBJECT" : null,
    } as Record<string, string | null>,
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

function markStageMs(
  progress: BidEmailAnalyzeProgress,
  stage: string,
  started: number
): void {
  const timings = progress.stageTimingsMs ?? {};
  timings[stage] = (timings[stage] ?? 0) + (Date.now() - started);
  progress.stageTimingsMs = timings;
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

async function resolveExistingCandidateForInvite(input: {
  prisma: PrismaClient;
  workspaceId: string;
  identityKey: string;
  threadId: string | null;
  projectName: string | null;
  projectNumber: string | null;
}): Promise<{ id: string; via: "identity" | "thread" | "number" } | null> {
  const byKey = await input.prisma.bidCandidate.findUnique({
    where: {
      workspaceId_identityKey: {
        workspaceId: input.workspaceId,
        identityKey: input.identityKey,
      },
    },
    select: { id: true, status: true },
  });
  if (byKey && byKey.status !== "REJECTED") {
    return { id: byKey.id, via: "identity" };
  }

  if (input.projectNumber) {
    const byNum = await input.prisma.bidCandidate.findFirst({
      where: {
        workspaceId: input.workspaceId,
        proposedJobNumber: input.projectNumber,
        status: { in: ["DISCOVERED", "READY", "NEEDS_REVIEW"] },
      },
      select: { id: true },
    });
    if (byNum) return { id: byNum.id, via: "number" };
  }

  if (input.threadId) {
    const link = await input.prisma.bidCandidateEmail.findFirst({
      where: {
        workspaceId: input.workspaceId,
        emailMessage: { threadId: input.threadId },
        bidCandidate: {
          status: { in: ["DISCOVERED", "READY", "NEEDS_REVIEW"] },
        },
      },
      select: { bidCandidateId: true },
      orderBy: { createdAt: "asc" },
    });
    if (link) return { id: link.bidCandidateId, via: "thread" };
  }

  return null;
}

/**
 * @deprecated Bid-first extract — retained for override-safety unit tests.
 * Production pipeline uses quote-first reconstruction via runBidStagingPipeline.
 */
export async function extractBidCandidatesFromDiscovery(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
  ai?: BidStagingAiContext | null;
}): Promise<void> {
  const stageStarted = Date.now();
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
        threadId: true,
      },
    });
    if (!email) continue;

    let fields = extractInviteFields(email);
    let pdfMeta: {
      attachmentIdsUsed: string[];
      hasTextUnavailable: boolean;
      hasUsablePdfText: boolean;
      combinedRelevant: string;
    } = {
      attachmentIdsUsed: [],
      hasTextUnavailable: false,
      hasUsablePdfText: false,
      combinedRelevant: "",
    };

    if (input.ai?.readObject) {
      try {
        const attResults = await ensureEmailAttachmentTexts({
          prisma: input.prisma,
          workspaceId: input.workspaceId,
          emailMessageId: email.id,
          readObject: input.ai.readObject,
        });
        pdfMeta = mergeAttachmentPdfTexts(attResults);
        if (pdfMeta.hasUsablePdfText) {
          const dueFromPdf = extractBidDueDateDeterministic({
            subject: email.subject,
            bodyText: pdfMeta.combinedRelevant,
          });
          if (!fields.bidDueAt && dueFromPdf) {
            fields = {
              ...fields,
              bidDueAt: new Date(`${dueFromPdf}T00:00:00.000Z`),
              fieldSources: {
                ...fields.fieldSources,
                proposedBidDueAt: "PDF_TEXT",
              },
            };
          }
          const identityPdf = resolveBidProjectIdentity({
            subject: email.subject,
            bodyText: `${email.bodyText ?? ""}\n${pdfMeta.combinedRelevant}`,
            pdfFilenames: fields.attachmentNames,
            customerCompanyName: null,
          });
          if (!fields.projectName && identityPdf.projectName) {
            fields = {
              ...fields,
              projectName: identityPdf.projectName,
              alternateNames: identityPdf.alternateProjectNames,
              fieldSources: {
                ...fields.fieldSources,
                proposedProjectName: "PDF_TEXT",
              },
            };
          }
        }
      } catch {
        /* PDF extract optional */
      }
    }

    let scopeDetail: DetailedScope = extractDetailedScopeDeterministic({
      subject: email.subject,
      bodyText: email.bodyText,
      attachmentNames: fields.attachmentNames,
      pdfText: pdfMeta.combinedRelevant || null,
    });
    const hasScopeEvidence = Boolean(
      (email.bodyText ?? "").trim() ||
        pdfMeta.hasUsablePdfText ||
        fields.attachmentNames.length
    );

    let aiApplied = false;
    let aiFailed = false;
    let aiNotes: string | null = null;
    const needsAi = bidFieldsNeedAiEnrichment({
      projectName: fields.projectName,
      customerName: fields.customerName,
      bidDueAt: fields.bidDueAt,
      projectNumber: fields.projectNumber,
      scopeDetailComplete: isDetailedScopeComplete(scopeDetail),
      hasScopeEvidence,
    });

    if (needsAi && input.ai?.bidExtractor.isConfigured()) {
      try {
        const aiResult = await input.ai.bidExtractor.extract({
          subject: email.subject ?? "",
          bodyText: email.bodyText ?? "",
          senderName: email.senderName,
          senderEmail: email.senderEmail,
          pdfFilenames: fields.attachmentNames,
          pdfText: pdfMeta.combinedRelevant || null,
          deterministic: {
            projectName: fields.projectName,
            customerName: fields.customerName,
            projectNumber: fields.projectNumber,
            bidDueDate: fields.bidDueAt
              ? fields.bidDueAt.toISOString().slice(0, 10)
              : null,
            scope: scopeSummaryString(scopeDetail),
            notes: null,
          },
        });
        bumpAiCalls(input.progress, "bid_extract");
        aiApplied = true;
        if (aiResult.projectName && !fields.projectName) {
          fields = {
            ...fields,
            projectName: aiResult.projectName,
            fieldSources: {
              ...fields.fieldSources,
              proposedProjectName: "AI_EXTRACTED",
            },
          };
        }
        if (aiResult.customerName) {
          fields = {
            ...fields,
            customerName: aiResult.customerName,
            fieldSources: {
              ...fields.fieldSources,
              proposedCustomerName: "AI_EXTRACTED",
            },
          };
        }
        if (aiResult.projectNumber && !fields.projectNumber) {
          fields = {
            ...fields,
            projectNumber: aiResult.projectNumber,
            fieldSources: {
              ...fields.fieldSources,
              proposedJobNumber: "AI_EXTRACTED",
            },
          };
        }
        if (aiResult.bidDueAt && !fields.bidDueAt) {
          const ymd = aiResult.bidDueAt.slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
            fields = {
              ...fields,
              bidDueAt: new Date(`${ymd}T00:00:00.000Z`),
              fieldSources: {
                ...fields.fieldSources,
                proposedBidDueAt: "AI_EXTRACTED",
              },
            };
          }
        }
        if (aiResult.scopeDetail) {
          scopeDetail = mergeAiScopeDetail(scopeDetail, aiResult.scopeDetail);
        }
        aiNotes = aiResult.notes;
      } catch {
        aiFailed = true;
      }
    }

    const scopeSummary = scopeSummaryString(scopeDetail);

    const identityKey = buildBidCandidateIdentityKey({
      projectNumber: fields.projectNumber,
      projectName: fields.projectName,
      customerName: fields.customerName,
      fallbackMessageId: email.id,
    });
    if (!identityKey) continue;

    const resolved = await resolveExistingCandidateForInvite({
      prisma: input.prisma,
      workspaceId: input.workspaceId,
      identityKey,
      threadId: email.threadId,
      projectName: fields.projectName,
      projectNumber: fields.projectNumber,
    });

    const existing = resolved
      ? await input.prisma.bidCandidate.findUnique({
          where: { id: resolved.id },
          select: {
            id: true,
            status: true,
            userEditedFields: true,
            proposedProjectName: true,
            proposedCustomerName: true,
            proposedBidDueAt: true,
            proposedJobNumber: true,
            proposedScope: true,
            proposedScopeDetail: true,
            proposedNotes: true,
            existingJobMatchStatus: true,
            evidence: true,
            confidence: true,
          },
        })
      : null;

    const emailRole = inviteEmailRoleFromSubject(email.subject);
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
        const scopeLocked =
          locked.has("proposedScope") || locked.has("proposedScopeDetail");
        const nextScope = scopeLocked
          ? existing.proposedScope
          : scopeSummary ?? existing.proposedScope;
        const nextScopeDetail = scopeLocked
          ? existing.proposedScopeDetail
          : (scopeDetail as unknown as Prisma.InputJsonValue);
        const nextNotes = locked.has("proposedNotes")
          ? existing.proposedNotes
          : aiNotes ?? existing.proposedNotes;
        const status =
          aiFailed && !nextName
            ? "NEEDS_REVIEW"
            : nextName && nextDue
              ? "READY"
              : nextName
                ? "DISCOVERED"
                : "NEEDS_REVIEW";
        const prevEv = evidenceObject(existing.evidence);
        await input.prisma.bidCandidate.update({
          where: { id: existing.id },
          data: {
            proposedProjectName: nextName,
            proposedCustomerName: nextCustomer,
            proposedBidDueAt: nextDue,
            proposedJobNumber: nextNumber,
            proposedScope: nextScope,
            proposedScopeDetail: nextScopeDetail as Prisma.InputJsonValue,
            proposedNotes: nextNotes,
            evidence: {
              ...prevEv,
              alternateNames: fields.alternateNames,
              attachments: fields.attachmentNames.slice(0, 20),
              fieldSources: {
                ...fields.fieldSources,
                proposedScope: scopeLocked
                  ? "USER_EDITED"
                  : scopeDetail.extractionMethod ?? "DETERMINISTIC",
              },
              attachmentIds: pdfMeta.attachmentIdsUsed,
              pdfTextUnavailable: pdfMeta.hasTextUnavailable,
              scopeDetailedComplete: isDetailedScopeComplete(scopeDetail),
              extractionMethod: aiApplied
                ? "AI_ENRICHED"
                : "DETERMINISTIC",
              aiFailed: aiFailed || undefined,
              groupedVia: resolved?.via,
            } as Prisma.InputJsonValue,
            status,
            confidence: nextName ? (aiApplied ? 0.7 : 0.75) : 0.4,
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
        aiFailed && !fields.projectName
          ? "NEEDS_REVIEW"
          : fields.projectName && fields.bidDueAt
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
          proposedScope: scopeSummary,
          proposedScopeDetail: scopeDetail as unknown as Prisma.InputJsonValue,
          proposedNotes: aiNotes,
          evidence: {
            alternateNames: fields.alternateNames,
            attachments: fields.attachmentNames.slice(0, 20),
            fieldSources: {
              ...fields.fieldSources,
              proposedScope: scopeDetail.extractionMethod ?? "DETERMINISTIC",
            },
            attachmentIds: pdfMeta.attachmentIdsUsed,
            pdfTextUnavailable: pdfMeta.hasTextUnavailable,
            scopeDetailedComplete: isDetailedScopeComplete(scopeDetail),
            extractionMethod: aiApplied ? "AI_ENRICHED" : "DETERMINISTIC",
            aiFailed: aiFailed || undefined,
          } as Prisma.InputJsonValue,
          status,
          confidence: fields.projectName ? (aiApplied ? 0.7 : 0.75) : 0.35,
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
        role: emailRole,
        isPrimary: !existing,
      },
      update: {
        // Preserve primary; allow role upgrade from SUPPORTING→ADDENDUM only.
        ...(emailRole === "ADDENDUM" ? { role: "ADDENDUM" } : {}),
      },
    });
  }

  markStageMs(input.progress, "EXTRACTING_BID_CANDIDATES", stageStarted);
  await writeProgress(input.prisma, input.runId, input.progress);
}

/** Extract BidQuoteStaging rows from Quote discovery. */
export async function extractQuotesFromDiscovery(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
  ai?: BidStagingAiContext | null;
}): Promise<void> {
  const stageStarted = Date.now();
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

    const filenames = filenamesFromMetadata(email.attachmentMetadata);
    let pdfMeta = {
      combinedRelevant: "",
      attachmentIdsUsed: [] as string[],
      hasTextUnavailable: false,
      hasUsablePdfText: false,
    };

    if (input.ai?.readObject) {
      try {
        const attResults = await ensureEmailAttachmentTexts({
          prisma: input.prisma,
          workspaceId: input.workspaceId,
          emailMessageId: email.id,
          readObject: input.ai.readObject,
        });
        pdfMeta = mergeAttachmentPdfTexts(attResults);
      } catch {
        /* optional */
      }
    }

    let fields = extractQuoteFieldsDeterministic({
      subject: email.subject,
      bodyText: email.bodyText,
      attachmentNames: filenames,
      pdfText: pdfMeta.combinedRelevant || null,
    });

    let aiApplied = false;
    let aiFailed = false;
    let displayName: string | null = null;
    let revisionNote: string | null = null;
    let scopeDetail: DetailedScope = fields.scopeDetail;

    const needsAi = quoteFieldsNeedAiEnrichment({
      amount: fields.amount,
      scope: fields.scope,
      scopeDetail,
      hasUsablePdfText: pdfMeta.hasUsablePdfText,
      hasBodyEvidence: Boolean((email.bodyText ?? "").trim()),
    });

    if (needsAi && input.ai?.quoteExtractor.isConfigured()) {
      try {
        const aiResult = await input.ai.quoteExtractor.extract({
          subject: email.subject ?? "",
          bodyText: email.bodyText ?? "",
          attachmentNames: filenames,
          pdfText: pdfMeta.combinedRelevant || null,
          deterministic: {
            scope: fields.scope,
            amount: fields.amount,
            currency: fields.currency,
            notes: fields.notes,
          },
        });
        bumpAiCalls(input.progress, "quote_extract");
        aiApplied = true;
        if (aiResult.amount != null && fields.amount == null) {
          fields = {
            ...fields,
            amount: aiResult.amount,
            currency: aiResult.currency ?? "USD",
            amountSource: "PDF_TEXT",
            evidence: [...fields.evidence, "amount:ai"],
          };
        }
        if (aiResult.scopeDetail) {
          scopeDetail = mergeAiScopeDetail(scopeDetail, aiResult.scopeDetail);
          fields = {
            ...fields,
            scope: scopeSummaryString(scopeDetail),
            scopeDetail,
            evidence: [...fields.evidence, "scope_detail:ai"],
          };
        } else if (aiResult.scope && !isDetailedScopeComplete(scopeDetail)) {
          // Compact AI scope string only — do not treat as detailed items.
          fields = {
            ...fields,
            scope: fields.scope ?? aiResult.scope,
            evidence: [...fields.evidence, "scope:ai_summary"],
          };
        }
        if (aiResult.notes) {
          fields = {
            ...fields,
            notes: fields.notes
              ? `${fields.notes}; ${aiResult.notes}`
              : aiResult.notes,
          };
        }
        displayName = aiResult.displayName;
        revisionNote = aiResult.revision;
      } catch {
        aiFailed = true;
      }
    }

    const existing = await input.prisma.bidQuoteStaging.findUnique({
      where: {
        workspaceId_emailMessageId: {
          workspaceId: input.workspaceId,
          emailMessageId: email.id,
        },
      },
      select: {
        id: true,
        userConfirmedMatch: true,
        userEditedFields: true,
        displayName: true,
        extractedScope: true,
        extractedScopeDetail: true,
        extractedAmount: true,
        currency: true,
        extractedNotes: true,
        matchStatus: true,
        extractionEvidence: true,
      },
    });

    const extractionEvidence = {
      labels: fields.evidence,
      amountSource: fields.amountSource,
      scopeSource: fields.scopeSource,
      attachmentIds: pdfMeta.attachmentIdsUsed,
      pdfTextUnavailable: pdfMeta.hasTextUnavailable,
      scopeDetailedComplete: isDetailedScopeComplete(scopeDetail),
      extractionMethod: aiApplied ? "AI_ENRICHED" : "DETERMINISTIC",
      revision: revisionNote,
      aiFailed: aiFailed || undefined,
      requiresOcr: pdfMeta.hasTextUnavailable || undefined,
    };

    if (existing) {
      if (existing.matchStatus === "REJECTED") {
        extracted += 1;
        continue;
      }
      const locked = lockedFields(existing.userEditedFields);
      const scopeLocked =
        locked.has("extractedScope") || locked.has("extractedScopeDetail");
      const nextNotes = locked.has("extractedNotes")
        ? existing.extractedNotes
        : [fields.notes, revisionNote].filter(Boolean).join("; ") || null;
      await input.prisma.bidQuoteStaging.update({
        where: { id: existing.id },
        data: {
          sourceSubject: email.subject,
          displayName: locked.has("displayName")
            ? existing.displayName
            : displayName ?? existing.displayName,
          extractedScope: scopeLocked
            ? existing.extractedScope
            : scopeSummaryString(scopeDetail) ?? fields.scope,
          extractedScopeDetail: scopeLocked
            ? (existing.extractedScopeDetail as Prisma.InputJsonValue)
            : (scopeDetail as unknown as Prisma.InputJsonValue),
          extractedAmount: locked.has("extractedAmount")
            ? existing.extractedAmount
            : fields.amount,
          currency: locked.has("currency") ? existing.currency : fields.currency,
          extractedNotes: nextNotes,
          extractionEvidence: extractionEvidence as Prisma.InputJsonValue,
          extractionConfidence: aiFailed
            ? Math.min(fields.confidence, 0.35)
            : fields.confidence,
        },
      });
    } else {
      await input.prisma.bidQuoteStaging.create({
        data: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          emailMessageId: email.id,
          sourceSubject: email.subject,
          displayName,
          extractedScope: scopeSummaryString(scopeDetail) ?? fields.scope,
          extractedScopeDetail: scopeDetail as unknown as Prisma.InputJsonValue,
          extractedAmount: fields.amount,
          currency: fields.currency,
          extractedNotes:
            [fields.notes, revisionNote].filter(Boolean).join("; ") || null,
          extractionEvidence: extractionEvidence as Prisma.InputJsonValue,
          extractionConfidence: aiFailed
            ? Math.min(fields.confidence, 0.35)
            : fields.confidence,
          matchStatus: "UNMATCHED",
        },
      });
    }
    extracted += 1;
  }

  input.progress.quotesExtracted = extracted;
  markStageMs(input.progress, "EXTRACTING_QUOTES", stageStarted);
  await writeProgress(input.prisma, input.runId, input.progress);
}

/** Match BidQuoteStaging → BidCandidates (and BidCandidateEmail links for MATCHED only). */
export async function matchQuotesToCandidates(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
  ai?: BidStagingAiContext | null;
}): Promise<void> {
  const stageStarted = Date.now();
  input.progress.currentPhase = "MATCHING_QUOTES";
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
    if (q.matchStatus === "REJECTED") continue;
    if (q.userConfirmedMatch) {
      if (q.matchStatus === "MATCHED") matched += 1;
      else if (q.matchStatus === "NEEDS_REVIEW" || q.matchStatus === "POSSIBLE_MATCH")
        needsReview += 1;
      else unmatched += 1;
      continue;
    }

    const inviteFields = extractInviteFields(q.emailMessage);

    const scoredAll: Array<{ id: string; score: number; evidence: string[] }> =
      [];
    for (const c of openCandidates) {
      const scored = scoreQuoteToBidCandidate({
        quoteProjectName: inviteFields.projectName,
        quoteProjectNumber: inviteFields.projectNumber,
        quoteCustomerName: inviteFields.customerName,
        quoteSubject: q.emailMessage.subject,
        quoteAttachmentNames: inviteFields.attachmentNames,
        candidate: c,
      });
      scoredAll.push({
        id: c.id,
        score: scored.score,
        evidence: scored.evidence,
      });
    }
    scoredAll.sort((a, b) => b.score - a.score);
    let best = scoredAll[0] ?? null;
    const second = scoredAll[1] ?? null;

    // Optional AI adjudication among top shortlist when ambiguous.
    if (
      best &&
      quoteMatchNeedsAiAdjudication({
        bestScore: best.score,
        secondScore: second?.score ?? null,
        autoLinkThreshold: QUOTE_AUTO_LINK_THRESHOLD,
        reviewThreshold: QUOTE_REVIEW_THRESHOLD,
      }) &&
      input.ai?.quoteMatchAdjudicator.isConfigured()
    ) {
      try {
        const shortlist = scoredAll.slice(0, 5).map((s) => {
          const c = openCandidates.find((x) => x.id === s.id)!;
          return {
            id: s.id,
            projectName: c.proposedProjectName,
            jobNumber: c.proposedJobNumber,
            customerName: c.proposedCustomerName,
            score: s.score,
            evidence: s.evidence,
          };
        });
        const adj = await input.ai.quoteMatchAdjudicator.adjudicate({
          quote: {
            subject: q.emailMessage.subject,
            scope: q.extractedScope,
            amount: q.extractedAmount != null ? Number(q.extractedAmount) : null,
            projectHints: [
              inviteFields.projectName,
              inviteFields.projectNumber,
            ].filter(Boolean) as string[],
            attachmentNames: inviteFields.attachmentNames,
          },
          shortlist,
        });
        bumpAiCalls(input.progress, "quote_match_adjudicate");
        if (adj.decision === "MATCH" && adj.bestCandidateId) {
          const picked = scoredAll.find((s) => s.id === adj.bestCandidateId);
          if (picked) {
            best = {
              ...picked,
              // Keep as review-band — human must confirm; do not auto MATCHED from AI.
              score: Math.min(
                QUOTE_AUTO_LINK_THRESHOLD - 0.01,
                Math.max(picked.score, adj.confidence ?? picked.score)
              ),
              evidence: [
                ...picked.evidence,
                `ai_adjudication:${adj.decision}`,
                adj.reason ? `ai_reason` : "ai_match",
              ],
            };
          }
        } else if (
          adj.decision === "UNMATCHED" ||
          adj.decision === "INSUFFICIENT_EVIDENCE"
        ) {
          // Fall through to unmatched / needs_review from deterministic score.
        }
      } catch {
        /* AI optional */
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
      // Ambiguous: stage proposal only — do NOT create BidCandidateEmail until MATCHED.
      await input.prisma.bidQuoteStaging.update({
        where: { id: q.id },
        data: {
          bidCandidateId: best.id,
          matchStatus: "NEEDS_REVIEW",
          matchConfidence: best.score,
          matchEvidence: {
            labels: best.evidence,
            needsReview: true,
            runnerUpId: second?.id ?? null,
          },
        },
      });
      // Remove any prior auto QUOTE link for this email on this candidate.
      await input.prisma.bidCandidateEmail.deleteMany({
        where: {
          bidCandidateId: best.id,
          emailMessageId: q.emailMessageId,
          role: "QUOTE",
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
  markStageMs(input.progress, "MATCHING_QUOTES", stageStarted);
  await writeProgress(input.prisma, input.runId, input.progress);
}

/**
 * Propose existing Job matches for open candidates via JobMatcher (staging only).
 * Does NOT call persistJobMatchResult / write EmailMessage.jobId.
 * AI may only suggest POSSIBLE — never RESOLVED_SAME.
 */
export async function matchExistingJobsForCandidates(input: {
  prisma: PrismaClient;
  workspaceId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
  ai?: BidStagingAiContext | null;
}): Promise<void> {
  const stageStarted = Date.now();
  input.progress.currentPhase = "MATCHING_EXISTING_JOBS";
  await writeProgress(input.prisma, input.runId, input.progress);

  const candidates = await input.prisma.bidCandidate.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: { in: ["DISCOVERED", "READY", "NEEDS_REVIEW"] },
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
    let evidence: Record<string, unknown> | null = null;

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

    // Optional AI among shortlist — suggestion only (never RESOLVED_SAME).
    if (
      existingJobNeedsAiAdjudication(status) &&
      ranked.length > 0 &&
      input.ai?.existingJobAdjudicator.isConfigured()
    ) {
      try {
        const adj = await input.ai.existingJobAdjudicator.adjudicate({
          candidate: {
            projectName: c.proposedProjectName,
            jobNumber: c.proposedJobNumber,
            customerName: c.proposedCustomerName,
          },
          shortlist: ranked.slice(0, 5).map((r) => {
            const job = jobs.find((j) => j.id === r.jobId);
            return {
              jobId: r.jobId,
              jobNumber: job?.jobNumber ?? null,
              name: job?.name ?? null,
              customerName: null,
              score: r.score,
              evidence: r.evidence.map((e) => e.type),
            };
          }),
        });
        bumpAiCalls(input.progress, "existing_job_adjudicate");
        if (
          adj.decision === "POSSIBLE_EXISTING_JOB" &&
          adj.suggestedJobId &&
          status !== "STRONG"
        ) {
          proposedExistingJobId = adj.suggestedJobId;
          status = "POSSIBLE";
          confidence = adj.confidence ?? confidence;
          evidence = {
            ...(evidence ?? {}),
            aiDecision: adj.decision,
            aiReason: adj.reason,
            note: "AI suggestion only — human must confirm before RESOLVED_SAME",
          };
        }
      } catch {
        /* optional */
      }
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
  markStageMs(input.progress, "MATCHING_EXISTING_JOBS", stageStarted);
  await writeProgress(input.prisma, input.runId, input.progress);
}

export type RunBidStagingPipelineInput = {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
  openaiApiKey?: string | null;
  openaiModel?: string;
  readAttachmentObject?:
    | ((storageKey: string) => Promise<Buffer | null>)
    | null;
};

/**
 * Quote-first staging after discovery (no Graph, no Jobs).
 * Quotes define population → group → match Bid Invites / Inbox → Candidates.
 */
export async function runBidStagingPipeline(
  input: RunBidStagingPipelineInput
): Promise<void> {
  const pipelineStarted = Date.now();
  input.progress.aiCalls = input.progress.aiCalls ?? 0;
  input.progress.aiCallsByOperation = input.progress.aiCallsByOperation ?? {};

  const ai = createBidStagingAiContext({
    ...(input.openaiApiKey !== undefined
      ? { openaiApiKey: input.openaiApiKey }
      : {}),
    ...(input.openaiModel !== undefined
      ? { openaiModel: input.openaiModel }
      : {}),
    readObject: input.readAttachmentObject ?? null,
  });

  const withAi = {
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    runId: input.runId,
    progress: input.progress,
    ai,
  };

  await extractQuotesFromDiscovery(withAi);
  const groups = await groupQuotesIntoProjects(withAi);
  await reconstructCandidatesFromQuoteGroups({
    ...withAi,
    groups,
  });
  await matchExistingJobsForCandidates({
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    runId: input.runId,
    progress: input.progress,
    ai,
  });
  input.progress.currentPhase = "READY_FOR_REVIEW";
  markStageMs(input.progress, "STAGING_PIPELINE_TOTAL", pipelineStarted);
  try {
    console.info(
      JSON.stringify({
        event: "bid_staging_pipeline_timing",
        runId: input.runId,
        quoteFirst: true,
        aiCalls: input.progress.aiCalls ?? 0,
        aiCallsByOperation: input.progress.aiCallsByOperation ?? {},
        stageTimingsMs: input.progress.stageTimingsMs ?? {},
        quoteProjectsIdentified: input.progress.quoteProjectsIdentified,
        originalBidFromInvites: input.progress.originalBidFromInvites,
        originalBidFromInbox: input.progress.originalBidFromInbox,
        originalBidNotFound: input.progress.originalBidNotFound,
        candidatesCreated: input.progress.candidatesCreated,
        candidatesUpdated: input.progress.candidatesUpdated,
        quotesExtracted: input.progress.quotesExtracted,
        quotesMatched: input.progress.quotesMatched,
      })
    );
  } catch {
    /* ignore */
  }
  await writeProgress(input.prisma, input.runId, input.progress);
}
