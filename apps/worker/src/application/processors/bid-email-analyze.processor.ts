/**
 * Bid Analysis processor: Projects/Bid Invites + Projects/Quotes only.
 * Stages BidCandidates — NEVER creates Jobs.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  TokenCipher,
  buildBidCandidateIdentityKey,
  emptyBidEmailAnalyzeProgress,
  extractBidDueDateDeterministic,
  formatMissingBiddingFolders,
  isBiddingFolderScanRangePreset,
  resolveBidProjectIdentity,
  resolveBiddingFolderScanSinceAt,
  resolveBiddingWorkflowFolders,
  scoreQuoteToBidCandidate,
  DEFAULT_BIDDING_FOLDER_SCAN_RANGE,
  QUOTE_AUTO_LINK_THRESHOLD,
  QUOTE_REVIEW_THRESHOLD,
  suggestBidProjectNameFromSubject,
  type BidEmailAnalyzeJobPayload,
  type BidEmailAnalyzeJobResult,
  type BidEmailAnalyzeProgress,
  type ProviderMailboxSyncResult,
  type ProviderMessageSnapshot,
  type ProviderThreadSnapshot,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

import { enqueueAttachmentIngestFromSync } from "../services/enqueue-attachment-ingest-from-sync.js";
import { importProviderMailbox } from "../services/import-provider-mailbox.js";
import {
  OutlookClient,
  type OutlookClientConfig,
  type OutlookMessageSnapshot,
} from "../../infrastructure/providers/outlook/outlook-client.js";
import type {
  AttachmentIngestJobPayload,
  AttachmentIngestResult,
} from "@forgeops/shared";

const PAGE_SIZE = 50;
const ABORT_MESSAGE = "Aborted from Worker Jobs. Staging rows already saved stay saved.";

function mapOutlookMessage(msg: OutlookMessageSnapshot): ProviderMessageSnapshot {
  return {
    providerMessageId: msg.outlookMessageId,
    providerThreadId: msg.conversationId,
    historyId: null,
    subject: msg.subject,
    senderName: msg.senderName,
    senderEmail: msg.senderEmail,
    toAddresses: msg.toAddresses,
    ccAddresses: msg.ccAddresses,
    bccAddresses: msg.bccAddresses,
    replyToAddresses: msg.replyToAddresses,
    snippet: msg.snippet,
    bodyText: msg.bodyText,
    bodyHtml: msg.bodyHtml,
    hasAttachments: msg.hasAttachments,
    attachmentMetadata: msg.attachmentMetadata.map((att) => ({
      attachmentId: att.attachmentId,
      contentId: att.contentId,
      filename: att.filename,
      inline: att.inline,
      mimeType: att.mimeType,
      partId: null,
      size: att.size,
    })),
    providerLabels: msg.folderLabels,
    sentAt: msg.sentAt,
    internetMessageId: msg.internetMessageId,
    receivedAt: msg.receivedAt,
    sizeEstimate: null,
  };
}

function threadsFromMessages(
  messages: OutlookMessageSnapshot[]
): ProviderThreadSnapshot[] {
  const byThread = new Map<string, ProviderMessageSnapshot[]>();
  for (const msg of messages) {
    const mapped = mapOutlookMessage(msg);
    const list = byThread.get(mapped.providerThreadId) ?? [];
    list.push(mapped);
    byThread.set(mapped.providerThreadId, list);
  }
  const threads: ProviderThreadSnapshot[] = [];
  for (const [providerThreadId, msgs] of byThread) {
    const sorted = [...msgs].sort(
      (a, b) =>
        (a.receivedAt?.getTime() ?? a.sentAt?.getTime() ?? 0) -
        (b.receivedAt?.getTime() ?? b.sentAt?.getTime() ?? 0)
    );
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    threads.push({
      providerThreadId,
      historyId: null,
      subject: first.subject,
      normalizedSubject: first.subject,
      snippet: last.snippet,
      participants: [
        ...(first.senderEmail
          ? [{ name: first.senderName, email: first.senderEmail, raw: first.senderEmail }]
          : []),
        ...first.toAddresses,
      ],
      firstMessageAt: first.receivedAt ?? first.sentAt ?? new Date(),
      lastMessageAt: last.receivedAt ?? last.sentAt ?? new Date(),
      messageCount: sorted.length,
      unreadCount: 0,
      messages: sorted,
    });
  }
  return threads;
}

async function writeProgress(
  prisma: PrismaClient,
  runId: string,
  progress: BidEmailAnalyzeProgress,
  extra?: { status?: "RUNNING" | "COMPLETED" | "FAILED"; errorMessage?: string | null }
): Promise<void> {
  await prisma.bidAnalysisRun.update({
    where: { id: runId },
    data: {
      progress: progress as unknown as Prisma.InputJsonValue,
      ...(extra?.status ? { status: extra.status } : {}),
      ...(extra?.errorMessage !== undefined
        ? { errorMessage: extra.errorMessage }
        : {}),
      ...(extra?.status === "COMPLETED" || extra?.status === "FAILED"
        ? { completedAt: new Date() }
        : {}),
    },
  });
}

export async function failOpenBidEmailAnalyzeRun(
  prisma: PrismaClient,
  runId: string,
  errorMessage: string
): Promise<void> {
  await prisma.bidAnalysisRun.updateMany({
    where: { id: runId, status: { in: ["PENDING", "RUNNING"] } },
    data: {
      status: "FAILED",
      errorMessage: errorMessage.slice(0, 2000),
      completedAt: new Date(),
    },
  });
}

async function cancelledResult(
  prisma: PrismaClient,
  payload: BidEmailAnalyzeJobPayload,
  progress: BidEmailAnalyzeProgress
): Promise<BidEmailAnalyzeJobResult | null> {
  const fresh = await prisma.bidAnalysisRun.findUnique({
    where: { id: payload.runId },
    select: { status: true, errorMessage: true },
  });
  if (fresh?.status !== "CANCELLED") return null;
  return {
    workspaceId: payload.workspaceId,
    inboxConnectionId: payload.inboxConnectionId,
    runId: payload.runId,
    status: "CANCELLED",
    progress,
    errorMessage: fresh.errorMessage ?? ABORT_MESSAGE,
  };
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
      if (a && typeof a === "object" && typeof (a as { filename?: unknown }).filename === "string") {
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

async function refreshOutlookToken(
  config: OutlookClientConfig,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const tenantId = config.tenantId ?? "common";
  const body = new URLSearchParams({
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: [
      "offline_access",
      "https://graph.microsoft.com/Mail.Read",
      "https://graph.microsoft.com/User.Read",
    ].join(" "),
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Outlook token refresh failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
  };
}

/**
 * Group Bid Invites into BidCandidates and match Quotes — from discovery index only.
 * Never creates Jobs. Never calls Graph.
 */
async function analyzeDiscoveredEmails(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
}): Promise<void> {
  const discoveries = await input.prisma.bidFolderDiscoveryEmail.findMany({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
    },
    select: { emailMessageId: true, role: true },
    orderBy: { firstDiscoveredAt: "asc" },
  });

  const inviteIds = discoveries
    .filter((d) => d.role === "BID_INVITE")
    .map((d) => d.emailMessageId);
  const quoteIds = discoveries
    .filter((d) => d.role === "QUOTE")
    .map((d) => d.emailMessageId);

  input.progress.bidInvitesFound = inviteIds.length;
  input.progress.quotesFound = quoteIds.length;
  await writeProgress(input.prisma, input.runId, input.progress);

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
        jobId: true,
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
      select: { id: true, status: true },
    });

    let candidateId: string;
    if (existing) {
      candidateId = existing.id;
      if (existing.status !== "CONFIRMED" && existing.status !== "REJECTED") {
        await input.prisma.bidCandidate.update({
          where: { id: existing.id },
          data: {
            ...(fields.projectName ? { proposedProjectName: fields.projectName } : {}),
            ...(fields.customerName
              ? { proposedCustomerName: fields.customerName }
              : {}),
            ...(fields.bidDueAt ? { proposedBidDueAt: fields.bidDueAt } : {}),
            ...(fields.projectNumber
              ? { proposedJobNumber: fields.projectNumber }
              : {}),
            evidence: {
              alternateNames: fields.alternateNames,
              attachments: fields.attachmentNames.slice(0, 20),
            } as Prisma.InputJsonValue,
            status:
              fields.projectName && fields.bidDueAt ? "READY" : "NEEDS_REVIEW",
            confidence: fields.projectName ? 0.75 : 0.4,
          },
        });
        input.progress.candidatesUpdated += 1;
      } else {
        input.progress.candidatesUpdated += 1;
      }
    } else {
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
          status:
            fields.projectName && fields.bidDueAt
              ? "READY"
              : fields.projectName
                ? "DISCOVERED"
                : "NEEDS_REVIEW",
          confidence: fields.projectName ? 0.75 : 0.35,
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

  for (const emailMessageId of quoteIds) {
    const email = await input.prisma.emailMessage.findFirst({
      where: { id: emailMessageId, workspaceId: input.workspaceId },
      select: {
        id: true,
        subject: true,
        bodyText: true,
        senderName: true,
        senderEmail: true,
        attachmentMetadata: true,
        jobId: true,
      },
    });
    if (!email) continue;
    const fields = extractInviteFields(email);

    if (email.jobId) {
      input.progress.quotesLinkedToJob += 1;
      const confirmed = await input.prisma.bidCandidate.findFirst({
        where: {
          workspaceId: input.workspaceId,
          canonicalJobId: email.jobId,
          status: "CONFIRMED",
        },
        select: { id: true },
      });
      if (confirmed) {
        await input.prisma.bidCandidateEmail.upsert({
          where: {
            bidCandidateId_emailMessageId: {
              bidCandidateId: confirmed.id,
              emailMessageId: email.id,
            },
          },
          create: {
            workspaceId: input.workspaceId,
            bidCandidateId: confirmed.id,
            emailMessageId: email.id,
            role: "QUOTE",
            matchConfidence: 1,
            matchEvidence: { reason: "existing_job_link", labels: ["existing_job"] },
          },
          update: {},
        });
        input.progress.quotesMatched += 1;
      } else {
        input.progress.quotesUnmatched += 1;
      }
      continue;
    }

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
      take: 200,
    });

    let best: { id: string; score: number; evidence: string[] } | null = null;
    for (const c of openCandidates) {
      const scored = scoreQuoteToBidCandidate({
        quoteProjectName: fields.projectName,
        quoteProjectNumber: fields.projectNumber,
        quoteCustomerName: fields.customerName,
        quoteSubject: email.subject,
        quoteAttachmentNames: fields.attachmentNames,
        candidate: c,
      });
      if (!best || scored.score > best.score) {
        best = { id: c.id, score: scored.score, evidence: scored.evidence };
      }
    }

    if (best && best.score >= QUOTE_AUTO_LINK_THRESHOLD) {
      await input.prisma.bidCandidateEmail.upsert({
        where: {
          bidCandidateId_emailMessageId: {
            bidCandidateId: best.id,
            emailMessageId: email.id,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          bidCandidateId: best.id,
          emailMessageId: email.id,
          role: "QUOTE",
          matchConfidence: best.score,
          matchEvidence: { labels: best.evidence },
        },
        update: {
          matchConfidence: best.score,
          matchEvidence: { labels: best.evidence },
        },
      });
      input.progress.quotesMatched += 1;
    } else if (best && best.score >= QUOTE_REVIEW_THRESHOLD) {
      await input.prisma.bidCandidateEmail.upsert({
        where: {
          bidCandidateId_emailMessageId: {
            bidCandidateId: best.id,
            emailMessageId: email.id,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          bidCandidateId: best.id,
          emailMessageId: email.id,
          role: "QUOTE",
          matchConfidence: best.score,
          matchEvidence: { labels: best.evidence, needsReview: true },
        },
        update: {
          matchConfidence: best.score,
          matchEvidence: { labels: best.evidence, needsReview: true },
        },
      });
      await input.prisma.bidCandidate.update({
        where: { id: best.id },
        data: { status: "NEEDS_REVIEW" },
      });
      input.progress.quotesMatched += 1;
    } else {
      input.progress.quotesUnmatched += 1;
    }
  }

  await writeProgress(input.prisma, input.runId, input.progress);
}

export async function processBidEmailAnalyze(
  payload: BidEmailAnalyzeJobPayload,
  deps: {
    prisma: PrismaClient;
    tokenCipher: TokenCipher;
    outlookConfig: OutlookClientConfig;
    attachmentIngestQueue: Queue<AttachmentIngestJobPayload, AttachmentIngestResult>;
    /** Injected Graph helpers for tests — production uses OutlookClient + fetch. */
    /** Injected without access token — production wraps Graph calls. */
    listTopLevelFolders?: () => Promise<Array<{ id: string; displayName: string }>>;
    listChildFolders?: (
      parentId: string
    ) => Promise<Array<{ id: string; displayName: string }>>;
    listFolderMessages?: (input: {
      refreshToken: string;
      folderId: string;
      pageSize: number;
      pageCursor: string | null;
      receivedAfter?: Date | null;
    }) => Promise<{
      items: OutlookMessageSnapshot[];
      nextPageCursor: string | null;
      refreshedRefreshToken?: string | null;
      accessToken?: string | null;
    }>;
    /** Capture folder IDs opened for message listing (regression tests). */
    onFolderMessagesRequested?: (folderId: string) => void;
    getAccessToken?: (refreshToken: string) => Promise<{
      accessToken: string;
      refreshToken: string;
    }>;
    finalAttempt?: boolean;
  }
): Promise<BidEmailAnalyzeJobResult> {
  const progress = emptyBidEmailAnalyzeProgress();
  const operation = payload.operation === "analyze" ? "analyze" : "scan";
  progress.operation = operation;

  const run = await deps.prisma.bidAnalysisRun.findFirst({
    where: {
      id: payload.runId,
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
    },
  });
  if (!run) throw new Error(`Bid analysis run not found: ${payload.runId}`);

  const presetRaw =
    payload.scanRangePreset ??
    (typeof (run as { scanRangePreset?: string }).scanRangePreset === "string"
      ? (run as { scanRangePreset: string }).scanRangePreset
      : DEFAULT_BIDDING_FOLDER_SCAN_RANGE);
  const preset = isBiddingFolderScanRangePreset(presetRaw)
    ? presetRaw
    : DEFAULT_BIDDING_FOLDER_SCAN_RANGE;
  const scanSinceAt =
    payload.scanSinceAt != null && payload.scanSinceAt !== ""
      ? new Date(payload.scanSinceAt)
      : (run as { scanSinceAt?: Date | null }).scanSinceAt ??
        resolveBiddingFolderScanSinceAt({ preset });
  progress.scanRangePreset = preset;
  progress.scanSinceAt = scanSinceAt?.toISOString() ?? null;

  const stopped = await cancelledResult(deps.prisma, payload, progress);
  if (stopped) return stopped;

  await deps.prisma.bidAnalysisRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      scanRangePreset: preset,
      scanSinceAt,
      progress: progress as unknown as Prisma.InputJsonValue,
      errorMessage: null,
    },
  });

  const connection = await deps.prisma.inboxConnection.findFirst({
    where: {
      id: payload.inboxConnectionId,
      workspaceId: payload.workspaceId,
    },
    select: {
      id: true,
      provider: true,
      email: true,
      encryptedRefreshToken: true,
    },
  });

  if (!connection) {
    const msg = "Mailbox connection not found";
    await writeProgress(deps.prisma, run.id, progress, { status: "FAILED", errorMessage: msg });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "FAILED",
      progress,
      errorMessage: msg,
    };
  }
  if (connection.provider !== "OUTLOOK") {
    const msg = "Bid analysis currently supports Outlook only";
    await writeProgress(deps.prisma, run.id, progress, { status: "FAILED", errorMessage: msg });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "FAILED",
      progress,
      errorMessage: msg,
    };
  }

  // Analyze uses discovery index only — no Graph token required.
  if (operation === "analyze") {
    try {
      progress.currentPhase = "ANALYZE_CANDIDATES";
      await writeProgress(deps.prisma, run.id, progress);
      await analyzeDiscoveredEmails({
        prisma: deps.prisma,
        workspaceId: payload.workspaceId,
        inboxConnectionId: payload.inboxConnectionId,
        runId: run.id,
        progress,
      });
      const stop = await cancelledResult(deps.prisma, payload, progress);
      if (stop) return stop;
      progress.currentPhase = "DONE";
      progress.currentFolderName = null;
      await writeProgress(deps.prisma, run.id, progress, { status: "COMPLETED" });
      return {
        workspaceId: payload.workspaceId,
        inboxConnectionId: payload.inboxConnectionId,
        runId: run.id,
        status: "COMPLETED",
        progress,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (deps.finalAttempt !== false) {
        await writeProgress(deps.prisma, run.id, progress, {
          status: "FAILED",
          errorMessage: msg.slice(0, 2000),
        });
        return {
          workspaceId: payload.workspaceId,
          inboxConnectionId: payload.inboxConnectionId,
          runId: run.id,
          status: "FAILED",
          progress,
          errorMessage: msg.slice(0, 2000),
        };
      }
      throw e;
    }
  }

  if (!connection.encryptedRefreshToken) {
    const msg = "Mailbox is not authorized for Graph access";
    await writeProgress(deps.prisma, run.id, progress, { status: "FAILED", errorMessage: msg });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "FAILED",
      progress,
      errorMessage: msg,
    };
  }

  const client = new OutlookClient(deps.outlookConfig);
  let refreshToken = deps.tokenCipher.decrypt(connection.encryptedRefreshToken);

  const getToken =
    deps.getAccessToken ??
    ((rt: string) => refreshOutlookToken(deps.outlookConfig, rt));

  try {
    progress.currentPhase = "RESOLVE_FOLDERS";
    await writeProgress(deps.prisma, run.id, progress);

    let tokenPair = await getToken(refreshToken);
    refreshToken = tokenPair.refreshToken;

    // Direct Graph only — never BFS all Projects children for messages.
    const listTopLevel =
      deps.listTopLevelFolders ??
      (async () => {
        const accessToken = tokenPair.accessToken;
        const out: Array<{ id: string; displayName: string }> = [];
        let url: string | null =
          "https://graph.microsoft.com/v1.0/me/mailFolders?$select=id,displayName&$top=100";
        while (url) {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) throw new Error(`Graph folders failed (${res.status})`);
          const data = (await res.json()) as {
            value?: Array<{ id: string; displayName: string }>;
            "@odata.nextLink"?: string;
          };
          out.push(
            ...(data.value ?? []).map((f) => ({
              id: f.id,
              displayName: f.displayName,
            }))
          );
          url = data["@odata.nextLink"] ?? null;
        }
        return out;
      });

    const listChildren =
      deps.listChildFolders ??
      (async (parentId: string) => {
        const accessToken = tokenPair.accessToken;
        const out: Array<{ id: string; displayName: string }> = [];
        let url: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(parentId)}/childFolders?$select=id,displayName&$top=100`;
        while (url) {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) throw new Error(`Graph childFolders failed (${res.status})`);
          const data = (await res.json()) as {
            value?: Array<{ id: string; displayName: string }>;
            "@odata.nextLink"?: string;
          };
          out.push(
            ...(data.value ?? []).map((f) => ({
              id: f.id,
              displayName: f.displayName,
            }))
          );
          url = data["@odata.nextLink"] ?? null;
        }
        return out;
      });

    const resolution = await resolveBiddingWorkflowFolders({
      listTopLevelFolders: listTopLevel,
      listChildFolders: listChildren,
    });

    if (!resolution.ok) {
      await writeProgress(deps.prisma, run.id, progress, {
        status: "FAILED",
        errorMessage: resolution.message,
      });
      return {
        workspaceId: payload.workspaceId,
        inboxConnectionId: payload.inboxConnectionId,
        runId: run.id,
        status: "FAILED",
        progress,
        errorMessage: resolution.message,
      };
    }

    const { result } = resolution;
    progress.bidInvitesFolderFound = Boolean(result.bidInvites);
    progress.quotesFolderFound = Boolean(result.quotes);
    progress.bidInvitesFolderName = result.bidInvites?.displayName ?? null;
    progress.quotesFolderName = result.quotes?.displayName ?? null;

    if (result.missingRoles.length > 0) {
      progress.warning = `Missing folder(s): ${formatMissingBiddingFolders(result.missingRoles)}`;
    }

    if (!result.bidInvites && !result.quotes) {
      const msg =
        progress.warning ??
        "Bid Invites and Quotes folders not found under Projects";
      await writeProgress(deps.prisma, run.id, progress, {
        status: "FAILED",
        errorMessage: msg,
      });
      return {
        workspaceId: payload.workspaceId,
        inboxConnectionId: payload.inboxConnectionId,
        runId: run.id,
        status: "FAILED",
        progress,
        errorMessage: msg,
      };
    }

    await writeProgress(deps.prisma, run.id, progress);

    const processFolder = async (
      folder: { id: string; displayName: string },
      phase: "BID_INVITES" | "QUOTES"
    ) => {
      progress.currentPhase = phase;
      progress.currentFolderName = folder.displayName;
      await writeProgress(deps.prisma, run.id, progress);

      let pageCursor: string | null = null;
      do {
        const stop = await cancelledResult(deps.prisma, payload, progress);
        if (stop) return stop;

        deps.onFolderMessagesRequested?.(folder.id);

        type FolderPage = {
          items: OutlookMessageSnapshot[];
          nextPageCursor: string | null;
          refreshedRefreshToken?: string | null;
        };
        const page: FolderPage = deps.listFolderMessages
          ? await deps.listFolderMessages({
              refreshToken,
              folderId: folder.id,
              pageSize: PAGE_SIZE,
              pageCursor,
              receivedAfter: scanSinceAt,
            })
          : await client.listMailFolderMessages({
              refreshToken,
              folderId: folder.id,
              pageSize: PAGE_SIZE,
              pageCursor,
              receivedAfter: scanSinceAt,
            });

        if (page.refreshedRefreshToken) refreshToken = page.refreshedRefreshToken;

        if (phase === "BID_INVITES") {
          progress.bidInvitesScanned += page.items.length;
        } else {
          progress.quotesScanned += page.items.length;
        }

        if (page.items.length === 0) {
          pageCursor = page.nextPageCursor;
          continue;
        }

        const mailbox: ProviderMailboxSyncResult = {
          threads: threadsFromMessages(page.items),
          newestSyncCursor: null,
          accessToken: null,
          accessTokenExpiresAt: null,
        };

        const importResult = await importProviderMailbox({
          prisma: deps.prisma,
          workspaceId: payload.workspaceId,
          inboxConnectionId: payload.inboxConnectionId,
          mailbox,
          bypassInboxClearedAt: true,
          origin: "BID_ANALYSIS",
        });

        progress.messagesCreated += importResult.createdMessageIds?.length ?? 0;
        progress.messagesExisting +=
          (importResult.updatedMessageIds?.length ?? 0) +
          (importResult.duplicateMessageIds?.length ?? 0);

        if (importResult.attachmentIngestCandidates.length > 0) {
          try {
            await enqueueAttachmentIngestFromSync({
              queue: deps.attachmentIngestQueue,
              workspaceId: payload.workspaceId,
              inboxConnectionId: payload.inboxConnectionId,
              candidates: importResult.attachmentIngestCandidates.map((c) => ({
                emailMessageId: c.emailMessageId,
                providerMessageId: c.providerMessageId,
              })),
            });
          } catch {
            /* non-fatal — filenames in metadata still support identity */
          }
        }

        const messageIds = [
          ...new Set([
            ...(importResult.createdMessageIds ?? []),
            ...(importResult.updatedMessageIds ?? []),
            ...(importResult.duplicateMessageIds ?? []),
          ]),
        ];

        const discoveryRole = phase === "BID_INVITES" ? "BID_INVITE" : "QUOTE";
        for (const emailMessageId of messageIds) {
          await deps.prisma.bidFolderDiscoveryEmail.upsert({
            where: {
              workspaceId_inboxConnectionId_emailMessageId: {
                workspaceId: payload.workspaceId,
                inboxConnectionId: payload.inboxConnectionId,
                emailMessageId,
              },
            },
            create: {
              workspaceId: payload.workspaceId,
              inboxConnectionId: payload.inboxConnectionId,
              emailMessageId,
              role: discoveryRole,
              lastSeenRunId: run.id,
              lastSeenAt: new Date(),
            },
            update: {
              role: discoveryRole,
              lastSeenRunId: run.id,
              lastSeenAt: new Date(),
            },
          });
          if (phase === "BID_INVITES") progress.bidInvitesFound += 1;
          else progress.quotesFound += 1;
          // Scan = discovery only. Candidate grouping runs via operation=analyze.
        }

        await writeProgress(deps.prisma, run.id, progress);
        pageCursor = page.nextPageCursor;
      } while (pageCursor);

      return null as BidEmailAnalyzeJobResult | null;
    };

    if (result.bidInvites) {
      const early = await processFolder(result.bidInvites, "BID_INVITES");
      if (early) return early;
    }
    if (result.quotes) {
      const early = await processFolder(result.quotes, "QUOTES");
      if (early) return early;
    }

    progress.currentPhase = "DONE";
    progress.currentFolderName = null;
    await writeProgress(deps.prisma, run.id, progress, { status: "COMPLETED" });

    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "COMPLETED",
      progress,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (deps.finalAttempt !== false) {
      await writeProgress(deps.prisma, run.id, progress, {
        status: "FAILED",
        errorMessage: msg.slice(0, 2000),
      });
      return {
        workspaceId: payload.workspaceId,
        inboxConnectionId: payload.inboxConnectionId,
        runId: run.id,
        status: "FAILED",
        progress,
        errorMessage: msg.slice(0, 2000),
      };
    }
    throw e;
  }
}
