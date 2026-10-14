/**
 * LOCAL: reproduce Clear All survivors that return on fresh GET.
 */
import { PrismaClient } from "@prisma/client";
import { clearBiddingAnalysisStaging } from "../src/application/services/clear-bidding-analysis.js";

const p = new PrismaClient();

async function main() {
  const suffix = `repro-${Date.now()}`;
  const workspace = await p.workspace.create({
    data: { name: `Repro ${suffix}`, slug: suffix },
  });
  const conn = await p.inboxConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: "OUTLOOK",
      email: `repro-${suffix}@example.com`,
      status: "ACTIVE",
    },
  });

  const thread = await p.emailThread.create({
    data: {
      workspaceId: workspace.id,
      inboxConnectionId: conn.id,
      gmailThreadId: `th-${suffix}`,
      subject: "Repro",
    },
  });

  // Shape A: legacy bid-first — BidCandidateEmail only, NO BidQuoteStaging,
  // discovery already gone (simulates prior incomplete clear / analyze-only remnant).
  const invite = await p.emailMessage.create({
    data: {
      workspaceId: workspace.id,
      inboxConnectionId: conn.id,
      threadId: thread.id,
      gmailMessageId: `gm-legacy-${suffix}`,
      gmailThreadId: thread.gmailThreadId,
      subject: "Legacy ITB Project Falcon",
      senderEmail: "gc@example.com",
      sentAt: new Date(),
      receivedAt: new Date(),
    },
  });
  const legacy = await p.bidCandidate.create({
    data: {
      workspaceId: workspace.id,
      identityKey: `legacy:${suffix}`,
      status: "READY",
      proposedProjectName: "Legacy Falcon",
      originalBidSource: "BID_INVITES_FOLDER",
    },
  });
  await p.bidCandidateEmail.create({
    data: {
      workspaceId: workspace.id,
      bidCandidateId: legacy.id,
      emailMessageId: invite.id,
      role: "BID_INVITE",
      isPrimary: true,
    },
  });
  // Intentionally NO discovery and NO quote staging for legacy.

  // Shape B: quote-first with discovery+quote (should clear with current logic).
  const quoteMsg = await p.emailMessage.create({
    data: {
      workspaceId: workspace.id,
      inboxConnectionId: conn.id,
      threadId: thread.id,
      gmailMessageId: `gm-q-${suffix}`,
      gmailThreadId: thread.gmailThreadId,
      subject: "Quote Project Alpha",
      senderEmail: "gc@example.com",
      sentAt: new Date(),
      receivedAt: new Date(),
    },
  });
  await p.bidFolderDiscoveryEmail.create({
    data: {
      workspaceId: workspace.id,
      inboxConnectionId: conn.id,
      emailMessageId: quoteMsg.id,
      role: "QUOTE",
    },
  });
  const modern = await p.bidCandidate.create({
    data: {
      workspaceId: workspace.id,
      identityKey: `modern:${suffix}`,
      status: "READY",
      proposedProjectName: "Modern Alpha",
      originalBidSource: "NONE",
    },
  });
  await p.bidCandidateEmail.create({
    data: {
      workspaceId: workspace.id,
      bidCandidateId: modern.id,
      emailMessageId: quoteMsg.id,
      role: "QUOTE",
    },
  });
  await p.bidQuoteStaging.create({
    data: {
      workspaceId: workspace.id,
      inboxConnectionId: conn.id,
      emailMessageId: quoteMsg.id,
      bidCandidateId: modern.id,
      matchStatus: "MATCHED",
      sourceSubject: quoteMsg.subject,
    },
  });

  const before = await p.bidCandidate.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true, proposedProjectName: true, status: true },
  });
  console.log("BEFORE_CLEAR", before);

  const clearResult = await clearBiddingAnalysisStaging({
    prisma: p,
    workspaceId: workspace.id,
    connectionId: conn.id,
  });
  console.log("CLEAR_RESULT", clearResult);

  const afterDb = await p.bidCandidate.findMany({
    where: { workspaceId: workspace.id },
    select: {
      id: true,
      proposedProjectName: true,
      status: true,
      emails: { select: { emailMessageId: true, role: true } },
    },
  });
  console.log("AFTER_CLEAR_DB", afterDb);

  // Fresh GET equivalent (current production query — workspace only, no mailbox).
  const freshGet = await p.bidCandidate.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
  console.log(
    "FRESH_GET_WORKSPACE",
    freshGet.map((c) => ({
      id: c.id,
      name: c.proposedProjectName,
      status: c.status,
    }))
  );

  const legacySurvived = afterDb.some((c) => c.id === legacy.id);
  const modernSurvived = afterDb.some((c) => c.id === modern.id);
  console.log(
    JSON.stringify({
      legacyId: legacy.id,
      modernId: modern.id,
      legacySurvived,
      modernSurvived,
      rootCauseHypothesis: legacySurvived
        ? "LEGACY_SHAPE_NO_DISCOVERY_NO_QUOTE_NOT_DELETED"
        : "OTHER",
    })
  );

  await p.workspace.delete({ where: { id: workspace.id } });
  if (legacySurvived) {
    console.log("REPRODUCED: legacy candidate survives Clear All and fresh GET");
    process.exit(2);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
