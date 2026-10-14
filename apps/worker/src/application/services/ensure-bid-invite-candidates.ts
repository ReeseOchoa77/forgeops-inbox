/**
 * Create/reuse permanent Bid Candidates for Bid Invites that have no Quote.
 * Prefer false split over false merge. Never creates Jobs.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildBidCandidateIdentityKey,
  isUserConfirmedBidCandidateEmail,
  resolveBidProjectIdentity,
  suggestBidProjectNameFromSubject,
} from "@forgeops/shared";
import { applyDeterministicBidInviteSubtype } from "./apply-bid-invite-subtype.js";
import type { BidEmailAnalyzeProgress } from "@forgeops/shared";

function writeProgress(
  prisma: PrismaClient,
  runId: string,
  progress: BidEmailAnalyzeProgress
) {
  return prisma.bidAnalysisRun.update({
    where: { id: runId },
    data: { progress: progress as unknown as Prisma.InputJsonValue },
  });
}

/**
 * For each discovered Bid Invite not already linked to a Candidate:
 * - ensure BID_OPPORTUNITY subtype
 * - create/reuse Candidate by name/customer identity (no Job number)
 * - durable BidCandidateEmail role BID_INVITE
 *
 * Ambiguous merges avoided: identity uses name (+ sender), else per-message key.
 */
export async function ensureBidInviteCandidates(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  runId: string;
  progress: BidEmailAnalyzeProgress;
}): Promise<{ created: number; linked: number; classified: number }> {
  input.progress.currentPhase = "BUILDING_CANDIDATES";
  await writeProgress(input.prisma, input.runId, input.progress);

  const discoveries = await input.prisma.bidFolderDiscoveryEmail.findMany({
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      role: "BID_INVITE",
    },
    select: {
      emailMessageId: true,
      emailMessage: {
        select: {
          id: true,
          subject: true,
          bodyText: true,
          senderName: true,
          senderEmail: true,
          attachmentMetadata: true,
          bidCandidateEmails: {
            select: {
              bidCandidateId: true,
              matchEvidence: true,
            },
          },
        },
      },
    },
  });

  const emailIds = discoveries.map((d) => d.emailMessageId);
  const classified = (
    await applyDeterministicBidInviteSubtype({
      prisma: input.prisma,
      workspaceId: input.workspaceId,
      emailMessageIds: emailIds,
    })
  ).applied;

  let created = 0;
  let linked = 0;

  for (const d of discoveries) {
    const msg = d.emailMessage;
    if (!msg) continue;

    // Preserve user-confirmed association to any Candidate.
    const userLink = msg.bidCandidateEmails.find((l) =>
      isUserConfirmedBidCandidateEmail(l.matchEvidence)
    );
    if (userLink) continue;

    // Already linked (analysis) — leave alone (idempotent).
    if (msg.bidCandidateEmails.length > 0) continue;

    const filenames: string[] = [];
    if (Array.isArray(msg.attachmentMetadata)) {
      for (const a of msg.attachmentMetadata) {
        if (a && typeof a === "object" && "filename" in a) {
          const fn = String((a as { filename?: string }).filename || "").trim();
          if (fn) filenames.push(fn);
        }
      }
    }

    const identity = resolveBidProjectIdentity({
      subject: msg.subject,
      bodyText: msg.bodyText,
      pdfFilenames: filenames,
      customerCompanyName: null,
    });
    const projectName =
      identity.projectName ??
      suggestBidProjectNameFromSubject(msg.subject) ??
      msg.subject?.trim() ??
      "Untitled Bid Invite";
    const customerName = msg.senderName?.trim() || null;

    const identityKey =
      buildBidCandidateIdentityKey({
        projectName,
        customerName,
        // Prefer separate Candidates when name is weak — per-message fallback.
        fallbackMessageId: msg.id,
      }) ?? `invite:${msg.id}`;

    let candidate = await input.prisma.bidCandidate.findUnique({
      where: {
        workspaceId_identityKey: {
          workspaceId: input.workspaceId,
          identityKey,
        },
      },
      select: {
        id: true,
        lifecycle: true,
        status: true,
        userEditedFields: true,
      },
    });

    if (!candidate) {
      candidate = await input.prisma.bidCandidate.create({
        data: {
          workspaceId: input.workspaceId,
          identityKey,
          lifecycle: "OPEN",
          status: "DISCOVERED",
          proposedProjectName: projectName,
          proposedCustomerName: customerName,
          originalBidSource: "BID_INVITES_FOLDER",
          evidence: {
            labels: ["bid_invite_no_quote", "folder_bid_invites"],
            quoteFirst: false,
          },
          confidence: 0.7,
        },
        select: {
          id: true,
          lifecycle: true,
          status: true,
          userEditedFields: true,
        },
      });
      created += 1;
      input.progress.candidatesCreated =
        (input.progress.candidatesCreated ?? 0) + 1;
    }

    await input.prisma.bidCandidateEmail.upsert({
      where: {
        bidCandidateId_emailMessageId: {
          bidCandidateId: candidate.id,
          emailMessageId: msg.id,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        bidCandidateId: candidate.id,
        emailMessageId: msg.id,
        role: "BID_INVITE",
        isPrimary: true,
        matchConfidence: 0.75,
        matchEvidence: {
          labels: ["bid_invites_folder", "no_quote_candidate"],
          source: "BID_INVITES_FOLDER",
        },
      },
      update: {
        // Do not demote user-confirmed evidence if somehow present.
        role: "BID_INVITE",
      },
    });
    linked += 1;
  }

  await writeProgress(input.prisma, input.runId, input.progress);
  return { created, linked, classified };
}
