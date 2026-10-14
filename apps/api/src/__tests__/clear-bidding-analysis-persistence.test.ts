/**
 * Integration: Clear Analysis must NOT delete permanent Bid Candidates.
 * Deletes reconstructable discovery/runs/ephemeral quotes only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";

const p = new PrismaClient();
const runDb = Boolean(process.env.DATABASE_URL);

describe.runIf(runDb)("Clear Analysis preserves permanent Candidates (Postgres)", () => {
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
  let ephemeralQuoteId = "";
  let durableQuoteId = "";

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

    const legacy = await p.bidCandidate.create({
      data: {
        workspaceId,
        identityKey: `leg:${suffix}`,
        status: "READY",
        lifecycle: "OPEN",
        proposedProjectName: "Legacy Survivor",
        userEditedFields: ["proposedProjectName"],
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
        lifecycle: "QUOTED",
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
    const durableQ = await p.bidQuoteStaging.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        emailMessageId: quoteMsg.id,
        bidCandidateId: modernId,
        matchStatus: "MATCHED",
        isDurable: true,
      },
    });
    durableQuoteId = durableQ.id;

    const ephemeralMsg = await p.emailMessage.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        threadId: thread.id,
        gmailMessageId: `gm-eph-${suffix}`,
        gmailThreadId: thread.gmailThreadId,
        subject: "Ephemeral quote extract",
        senderEmail: "gc@example.com",
        sentAt: new Date(),
        receivedAt: new Date(),
      },
    });
    const ephemeral = await p.bidQuoteStaging.create({
      data: {
        workspaceId,
        inboxConnectionId: connectionId,
        emailMessageId: ephemeralMsg.id,
        matchStatus: "UNMATCHED",
        isDurable: false,
      },
    });
    ephemeralQuoteId = ephemeral.id;

    const confirmed = await p.bidCandidate.create({
      data: {
        workspaceId,
        identityKey: `conf:${suffix}`,
        status: "CONFIRMED",
        lifecycle: "CONVERTED",
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

  it("Clear Analysis keeps Candidates, durable quotes, emails, Jobs; drops scan artifacts", async () => {
    const clear1 = await clearBiddingAnalysisStaging({
      prisma: p,
      workspaceId,
      connectionId,
    });
    expect(clear1.candidatesDeleted).toBe(0);
    expect(clear1.candidateEmailsUnlinked).toBe(0);
    expect(clear1.quotesDeleted).toBe(1);
    expect(clear1.discoveryDeleted).toBeGreaterThanOrEqual(1);
    expect(clear1.runsDeleted).toBe(1);

    expect(await p.bidCandidate.findUnique({ where: { id: legacyId } })).not.toBeNull();
    expect(await p.bidCandidate.findUnique({ where: { id: modernId } })).not.toBeNull();
    expect(await p.bidCandidate.findUnique({ where: { id: confirmedId } })).not.toBeNull();

    const legacy = await p.bidCandidate.findUnique({ where: { id: legacyId } });
    expect(legacy?.userEditedFields).toEqual(["proposedProjectName"]);

    expect(
      await p.bidCandidateEmail.count({ where: { bidCandidateId: legacyId } })
    ).toBe(1);
    expect(
      await p.bidCandidateEmail.count({ where: { bidCandidateId: modernId } })
    ).toBe(1);

    expect(
      await p.bidQuoteStaging.findUnique({ where: { id: durableQuoteId } })
    ).not.toBeNull();
    expect(
      await p.bidQuoteStaging.findUnique({ where: { id: ephemeralQuoteId } })
    ).toBeNull();

    expect(
      await p.emailMessage.findUnique({ where: { id: emailMessageId } })
    ).not.toBeNull();
    const att = await p.emailAttachment.findUnique({
      where: { id: attachmentId },
    });
    expect(att?.extractedText).toBe("KEEP ME");
    expect(await p.job.findUnique({ where: { id: jobId } })).not.toBeNull();
    expect(await p.job.findUnique({ where: { id: jobId } })).toMatchObject({
      status: "BIDDING",
    });
    expect(
      await p.customer.findUnique({ where: { id: customerId } })
    ).not.toBeNull();

    expect(
      await p.bidFolderDiscoveryEmail.count({
        where: { inboxConnectionId: connectionId },
      })
    ).toBe(0);
    expect(
      await p.bidAnalysisRun.count({
        where: { inboxConnectionId: connectionId },
      })
    ).toBe(0);

    const clear2 = await clearBiddingAnalysisStaging({
      prisma: p,
      workspaceId,
      connectionId,
    });
    expect(clear2.candidatesDeleted).toBe(0);
    expect(clear2.quotesDeleted).toBe(0);
  });
});
