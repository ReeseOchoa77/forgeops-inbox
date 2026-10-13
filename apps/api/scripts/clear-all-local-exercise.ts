/**
 * LOCAL-ONLY: seed bidding-analysis staging for two mailboxes, run Clear All on A,
 * verify B untouched and canonical rows retained. Does not reset the database.
 */
import { PrismaClient } from "@prisma/client";
import { clearBiddingAnalysisStaging } from "../src/application/services/clear-bidding-analysis.js";

const p = new PrismaClient();

async function counts(connectionId: string) {
  return {
    discovery: await p.bidFolderDiscoveryEmail.count({
      where: { inboxConnectionId: connectionId },
    }),
    quotes: await p.bidQuoteStaging.count({
      where: { inboxConnectionId: connectionId },
    }),
    runs: await p.bidAnalysisRun.count({
      where: { inboxConnectionId: connectionId },
    }),
  };
}

async function main() {
  const suffix = `clear-all-${Date.now()}`;
  const workspace = await p.workspace.create({
    data: {
      name: `Clear All Test ${suffix}`,
      slug: suffix,
    },
  });

  const connA = await p.inboxConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: "OUTLOOK",
      email: `a-${suffix}@example.com`,
      status: "ACTIVE",
    },
  });
  const connB = await p.inboxConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: "OUTLOOK",
      email: `b-${suffix}@example.com`,
      status: "ACTIVE",
    },
  });

  const customer = await p.customer.create({
    data: {
      workspaceId: workspace.id,
      name: `Customer ${suffix}`,
      normalizedName: `customer ${suffix}`,
    },
  });
  const job = await p.job.create({
    data: {
      workspaceId: workspace.id,
      name: `Job ${suffix}`,
      normalizedName: `job ${suffix}`,
      status: "BIDDING",
      customerId: customer.id,
    },
  });

  async function seedMailbox(
    connId: string,
    tag: string,
    opts: { confirmed?: boolean; inboxFallback?: boolean }
  ) {
    const thread = await p.emailThread.create({
      data: {
        workspaceId: workspace.id,
        inboxConnectionId: connId,
        gmailThreadId: `th-${tag}-${suffix}`,
        subject: `Thread ${tag}`,
      },
    });
    const quoteMsg = await p.emailMessage.create({
      data: {
        workspaceId: workspace.id,
        inboxConnectionId: connId,
        threadId: thread.id,
        gmailMessageId: `gm-q-${tag}-${suffix}`,
        gmailThreadId: thread.gmailThreadId,
        subject: `${tag} Quote`,
        senderEmail: "gc@example.com",
        senderName: "GC",
        sentAt: new Date(),
        receivedAt: new Date(),
      },
    });
    const inviteMsg = await p.emailMessage.create({
      data: {
        workspaceId: workspace.id,
        inboxConnectionId: connId,
        threadId: thread.id,
        gmailMessageId: `gm-i-${tag}-${suffix}`,
        gmailThreadId: thread.gmailThreadId,
        subject: `${tag} ITB`,
        senderEmail: "gc@example.com",
        senderName: "GC",
        sentAt: new Date(),
        receivedAt: new Date(),
      },
    });
    const inboxMsg = opts.inboxFallback
      ? await p.emailMessage.create({
          data: {
            workspaceId: workspace.id,
            inboxConnectionId: connId,
            threadId: thread.id,
            gmailMessageId: `gm-inbox-${tag}-${suffix}`,
            gmailThreadId: thread.gmailThreadId,
            subject: `${tag} Inbox Bid`,
            senderEmail: "gc@example.com",
            senderName: "GC",
            sentAt: new Date(),
            receivedAt: new Date(),
          },
        })
      : null;

    const att = await p.emailAttachment.create({
      data: {
        workspaceId: workspace.id,
        emailMessageId: quoteMsg.id,
        filename: `${tag}.pdf`,
        sanitizedFilename: `${tag}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 100,
        storageKey: `local/${suffix}/${tag}.pdf`,
        providerAttachmentId: `att-${tag}-${suffix}`,
        extractedText: "PDF CACHED TEXT MUST REMAIN",
        extractedTextChars: 28,
        textExtractStatus: "READY",
        textExtractedAt: new Date(),
      },
    });

    await p.bidFolderDiscoveryEmail.createMany({
      data: [
        {
          workspaceId: workspace.id,
          inboxConnectionId: connId,
          emailMessageId: quoteMsg.id,
          role: "QUOTE",
        },
        {
          workspaceId: workspace.id,
          inboxConnectionId: connId,
          emailMessageId: inviteMsg.id,
          role: "BID_INVITE",
        },
      ],
    });

    const candidate = await p.bidCandidate.create({
      data: {
        workspaceId: workspace.id,
        identityKey: `clear-test:${tag}:${suffix}`,
        status: opts.confirmed ? "CONFIRMED" : "READY",
        proposedProjectName: `${tag} Project`,
        originalBidSource: opts.inboxFallback
          ? "INBOX_FALLBACK"
          : "BID_INVITES_FOLDER",
        ...(opts.confirmed
          ? { canonicalJobId: job.id, confirmedAt: new Date() }
          : {}),
      },
    });

    await p.bidCandidateEmail.createMany({
      data: [
        {
          workspaceId: workspace.id,
          bidCandidateId: candidate.id,
          emailMessageId: inviteMsg.id,
          role: "BID_INVITE",
          isPrimary: !opts.inboxFallback,
        },
        {
          workspaceId: workspace.id,
          bidCandidateId: candidate.id,
          emailMessageId: quoteMsg.id,
          role: "QUOTE",
        },
        ...(inboxMsg
          ? [
              {
                workspaceId: workspace.id,
                bidCandidateId: candidate.id,
                emailMessageId: inboxMsg.id,
                role: "BID_INVITE" as const,
                isPrimary: true,
              },
            ]
          : []),
      ],
    });

    await p.bidQuoteStaging.create({
      data: {
        workspaceId: workspace.id,
        inboxConnectionId: connId,
        emailMessageId: quoteMsg.id,
        sourceSubject: quoteMsg.subject,
        bidCandidateId: candidate.id,
        matchStatus: "MATCHED",
        extractedAmount: 1000,
      },
    });

    await p.bidAnalysisRun.create({
      data: {
        workspaceId: workspace.id,
        inboxConnectionId: connId,
        status: "COMPLETED",
        scanRangePreset: "90d",
        progress: { currentPhase: "READY_FOR_REVIEW" },
      },
    });

    return { quoteMsg, inviteMsg, inboxMsg, att, candidate };
  }

  const seededA = await seedMailbox(connA.id, "A", { inboxFallback: true });
  const seededB = await seedMailbox(connB.id, "B", {});
  const seededConfirmed = await seedMailbox(connA.id, "A-conf", {
    confirmed: true,
  });

  const beforeA = await counts(connA.id);
  const beforeB = await counts(connB.id);
  const beforeMsgs = await p.emailMessage.count({
    where: { workspaceId: workspace.id },
  });
  const beforeAttText = await p.emailAttachment.findUnique({
    where: { id: seededA.att.id },
    select: { extractedText: true },
  });

  console.log(
    JSON.stringify(
      {
        phase: "BEFORE",
        mailboxA: beforeA,
        mailboxB: beforeB,
        emailMessages: beforeMsgs,
        attachmentText: beforeAttText?.extractedText,
        jobExists: Boolean(await p.job.findUnique({ where: { id: job.id } })),
        customerExists: Boolean(
          await p.customer.findUnique({ where: { id: customer.id } })
        ),
      },
      null,
      2
    )
  );

  const result1 = await clearBiddingAnalysisStaging({
    prisma: p,
    workspaceId: workspace.id,
    connectionId: connA.id,
  });
  const result2 = await clearBiddingAnalysisStaging({
    prisma: p,
    workspaceId: workspace.id,
    connectionId: connA.id,
  });

  const afterA = await counts(connA.id);
  const afterB = await counts(connB.id);
  const afterMsgs = await p.emailMessage.count({
    where: { workspaceId: workspace.id },
  });
  const afterAttText = await p.emailAttachment.findUnique({
    where: { id: seededA.att.id },
    select: { extractedText: true },
  });
  const openAGone = !(await p.bidCandidate.findUnique({
    where: { id: seededA.candidate.id },
  }));
  const confirmedKept = await p.bidCandidate.findUnique({
    where: { id: seededConfirmed.candidate.id },
    select: { status: true, id: true },
  });
  const bCandidateKept = await p.bidCandidate.findUnique({
    where: { id: seededB.candidate.id },
    select: { id: true, status: true },
  });
  const inboxFallbackLinkGone = !(await p.bidCandidateEmail.findFirst({
    where: {
      emailMessageId: seededA.inboxMsg!.id,
    },
  }));

  console.log(
    JSON.stringify(
      {
        phase: "AFTER",
        clearResult1: result1,
        clearResult2: result2,
        mailboxA: afterA,
        mailboxB: afterB,
        openCandidateADeleted: openAGone,
        inboxFallbackLinkGone,
        emailMessages: afterMsgs,
        attachmentText: afterAttText?.extractedText,
        confirmedKept,
        mailboxBCandidateKept: bCandidateKept,
        jobExists: Boolean(await p.job.findUnique({ where: { id: job.id } })),
        customerExists: Boolean(
          await p.customer.findUnique({ where: { id: customer.id } })
        ),
      },
      null,
      2
    )
  );

  const ok =
    afterA.discovery === 0 &&
    afterA.quotes === 0 &&
    afterA.runs === 0 &&
    afterB.discovery === beforeB.discovery &&
    afterB.quotes === beforeB.quotes &&
    afterB.runs === beforeB.runs &&
    afterMsgs === beforeMsgs &&
    afterAttText?.extractedText === "PDF CACHED TEXT MUST REMAIN" &&
    confirmedKept?.status === "CONFIRMED" &&
    Boolean(bCandidateKept) &&
    openAGone &&
    inboxFallbackLinkGone &&
    result2.candidatesDeleted === 0;

  await p.workspace.delete({ where: { id: workspace.id } });

  if (!ok) {
    console.error("CLEAR ALL LOCAL EXERCISE FAILED");
    process.exit(1);
  }
  console.log("CLEAR ALL LOCAL EXERCISE PASSED");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
