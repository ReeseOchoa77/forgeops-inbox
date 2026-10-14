/**
 * Integration: Clear All must persist — fresh GET after clear returns 0 active Candidates.
 * Models the real bug: legacy BidCandidateEmail-only remnant (no discovery/quotes).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";
import { activeBidCandidatesForMailboxWhere } from "../application/services/bid-candidate-mailbox-scope.js";

const p = new PrismaClient();
const runDb = Boolean(process.env.DATABASE_URL);

describe.runIf(runDb)("Clear All persistence (real Postgres)", () => {
  const suffix = `persist-${Date.now()}`;
  let workspaceId = "";
  let connectionId = "";
  let legacyId = "";
  let modernId = "";
  let confirmedId = "";
  let emailMessageId = "";
  let attachmentId = "";
  let jobId = "";
  let customerId = "";

  beforeAll(async () => {
    const workspace = await p.workspace.create({
      data: { name: `Persist ${suffix}`, slug: suffix },
    });
    workspaceId = workspace.id;
    const conn = await p.inboxConnection.create({
      data: {
        workspaceId,
        provider: "OUTLOOK",
        email: `persist-${suffix}@example.com`,
        status: "ACTIVE",
      },
    });
    connectionId = conn.id;

    const customer = await p.customer.create({
      data: {
        workspaceId,
        name: `Cust ${suffix}`,
        normalizedName: `cust ${suffix}`,
      },
    });
    customerId = customer.id;
    const job = await p.job.create({
      data: {
        workspaceId,
        name: `Job ${suffix}`,
        normalizedName: `job ${suffix}`,
        status: "BIDDING",
        customerId,
      },
    });
    jobId = job.id;

    const thread = await p.emailThread.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        gmailThreadId: `th-${suffix}`,
        subject: "Persist",
      },
    });

    const invite = await p.emailMessage.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        threadId: thread.id,
        gmailMessageId: `gm-leg-${suffix}`,
        gmailThreadId: thread.gmailThreadId,
        subject: "Legacy ITB",
        senderEmail: "gc@example.com",
        sentAt: new Date(),
        receivedAt: new Date(),
      },
    });
    emailMessageId = invite.id;

    const att = await p.emailAttachment.create({
      data: {
        workspaceId,
        emailMessageId: invite.id,
        filename: "x.pdf",
        sanitizedFilename: "x.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageKey: `local/${suffix}/x.pdf`,
        providerAttachmentId: `att-${suffix}`,
        extractedText: "KEEP ME",
        extractedTextChars: 7,
        textExtractStatus: "READY",
        textExtractedAt: new Date(),
      },
    });
    attachmentId = att.id;

    // Legacy remnant: email link only — no discovery, no quote staging.
    const legacy = await p.bidCandidate.create({
      data: {
        workspaceId,
        identityKey: `leg:${suffix}`,
        status: "READY",
        proposedProjectName: "Legacy Survivor",
      },
    });
    legacyId = legacy.id;
    await p.bidCandidateEmail.create({
      data: {
        workspaceId,
        bidCandidateId: legacyId,
        emailMessageId: invite.id,
        role: "BID_INVITE",
        isPrimary: true,
      },
    });

    const quoteMsg = await p.emailMessage.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        threadId: thread.id,
        gmailMessageId: `gm-q-${suffix}`,
        gmailThreadId: thread.gmailThreadId,
        subject: "Quote",
        senderEmail: "gc@example.com",
        sentAt: new Date(),
        receivedAt: new Date(),
      },
    });
    await p.bidFolderDiscoveryEmail.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        emailMessageId: quoteMsg.id,
        role: "QUOTE",
      },
    });
    const modern = await p.bidCandidate.create({
      data: {
        workspaceId,
        identityKey: `mod:${suffix}`,
        status: "NEEDS_REVIEW",
        proposedProjectName: "Modern",
      },
    });
    modernId = modern.id;
    await p.bidCandidateEmail.create({
      data: {
        workspaceId,
        bidCandidateId: modernId,
        emailMessageId: quoteMsg.id,
        role: "QUOTE",
      },
    });
    await p.bidQuoteStaging.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        emailMessageId: quoteMsg.id,
        bidCandidateId: modernId,
        matchStatus: "MATCHED",
      },
    });

    const confirmed = await p.bidCandidate.create({
      data: {
        workspaceId,
        identityKey: `conf:${suffix}`,
        status: "CONFIRMED",
        proposedProjectName: "Imported",
        canonicalJobId: jobId,
        confirmedAt: new Date(),
      },
    });
    confirmedId = confirmed.id;
    await p.bidCandidateEmail.create({
      data: {
        workspaceId,
        bidCandidateId: confirmedId,
        emailMessageId: invite.id,
        role: "BID_INVITE",
        isPrimary: true,
      },
    });

    await p.bidAnalysisRun.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        status: "COMPLETED",
        scanRangePreset: "90d",
        progress: {},
      },
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await p.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
    }
    await p.$disconnect();
  });

  it("GET before clear returns active candidates including legacy remnant", async () => {
    const rows = await p.bidCandidate.findMany({
      where: activeBidCandidatesForMailboxWhere({
        workspaceId,
        connectionId,
      }),
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(legacyId);
    expect(ids).toContain(modernId);
    expect(ids).not.toContain(confirmedId);
  });

  it("Clear All then fresh GET → 0 active; legacy deleted; confirmed + emails kept", async () => {
    const clear1 = await clearBiddingAnalysisStaging({
      prisma: p,
      workspaceId,
      connectionId,
    });
    expect(clear1.candidatesDeleted).toBeGreaterThanOrEqual(2);

    // Fresh request context (not frontend cache).
    const after = await p.bidCandidate.findMany({
      where: activeBidCandidatesForMailboxWhere({
        workspaceId,
        connectionId,
      }),
    });
    expect(after).toHaveLength(0);

    expect(await p.bidCandidate.findUnique({ where: { id: legacyId } })).toBeNull();
    expect(await p.bidCandidate.findUnique({ where: { id: modernId } })).toBeNull();

    const confirmed = await p.bidCandidate.findUnique({
      where: { id: confirmedId },
    });
    expect(confirmed?.status).toBe("CONFIRMED");

    expect(
      await p.emailMessage.findUnique({ where: { id: emailMessageId } })
    ).not.toBeNull();
    const att = await p.emailAttachment.findUnique({
      where: { id: attachmentId },
    });
    expect(att?.extractedText).toBe("KEEP ME");
    expect(await p.job.findUnique({ where: { id: jobId } })).not.toBeNull();
    expect(
      await p.customer.findUnique({ where: { id: customerId } })
    ).not.toBeNull();

    expect(
      await p.bidFolderDiscoveryEmail.count({
        where: { inboxConnectionId: connectionId },
      })
    ).toBe(0);
    expect(
      await p.bidQuoteStaging.count({
        where: { inboxConnectionId: connectionId },
      })
    ).toBe(0);
    expect(
      await p.bidAnalysisRun.count({
        where: { inboxConnectionId: connectionId },
      })
    ).toBe(0);

    // Idempotent second clear
    const clear2 = await clearBiddingAnalysisStaging({
      prisma: p,
      workspaceId,
      connectionId,
    });
    expect(clear2.candidatesDeleted).toBe(0);
    expect(
      await p.bidCandidate.findMany({
        where: activeBidCandidatesForMailboxWhere({
          workspaceId,
          connectionId,
        }),
      })
    ).toHaveLength(0);
  });
});
