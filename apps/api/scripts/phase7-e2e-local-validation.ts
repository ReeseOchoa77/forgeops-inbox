/**
 * Phase 7 — disposable local forgeops_dev fixture exercise.
 * Creates clearly marked test records, runs Convert preview/commit, checks invariants, deletes fixtures.
 * Refuses non-development / non-local DB.
 */
import { PrismaClient } from "@prisma/client";
import {
  convertBidCandidateToJob,
  previewConvertBidCandidateToJob,
} from "../src/application/services/convert-bid-candidate-to-job.js";
import { clearBiddingAnalysisStaging } from "../src/application/services/clear-bidding-analysis.js";

function assertLocalDev(): void {
  const appEnv = process.env.APP_ENV ?? "development";
  if (appEnv !== "development" && appEnv !== "dev" && appEnv !== "local") {
    throw new Error(`Refusing Phase 7 fixture run: APP_ENV=${appEnv}`);
  }
  const db = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|forgeops_dev/.test(db)) {
    throw new Error("Refusing Phase 7 fixture run: DATABASE_URL is not local forgeops_dev");
  }
}

const MARKER = "[PHASE7_E2E_FIXTURE]";

async function main() {
  assertLocalDev();
  const prisma = new PrismaClient();
  const report: Record<string, unknown> = { ok: true, steps: [] as string[] };
  const steps = report.steps as string[];

  try {
    const ws = await prisma.workspace.findFirst({ select: { id: true } });
    const user = await prisma.user.findFirst({ select: { id: true } });
    const conn = await prisma.inboxConnection.findFirst({
      where: ws ? { workspaceId: ws.id } : undefined,
      select: { id: true, workspaceId: true },
    });
    if (!ws || !user || !conn) {
      throw new Error("Need local workspace + user + inboxConnection");
    }
    const workspaceId = ws.id;
    const userId = user.id;
    const inboxConnectionId = conn.id;

    // Cleanup any prior phase7 fixtures (FK-safe order).
    const priorMsgs = await prisma.emailMessage.findMany({
      where: { workspaceId, subject: { startsWith: MARKER } },
      select: { id: true, threadId: true },
    });
    const priorMsgIds = priorMsgs.map((m) => m.id);
    const priorThreadIds = [...new Set(priorMsgs.map((m) => m.threadId))];
    if (priorMsgIds.length > 0) {
      await prisma.bidCandidateEmail.deleteMany({
        where: { emailMessageId: { in: priorMsgIds } },
      });
      await prisma.bidQuoteStaging.deleteMany({
        where: { emailMessageId: { in: priorMsgIds } },
      });
      await prisma.classification.deleteMany({
        where: { messageId: { in: priorMsgIds } },
      });
    }
    const priorJobs = await prisma.job.findMany({
      where: { workspaceId, name: { startsWith: MARKER } },
      select: { id: true },
    });
    const priorJobIds = priorJobs.map((j) => j.id);
    if (priorJobIds.length > 0) {
      await prisma.bidCandidate.updateMany({
        where: { canonicalJobId: { in: priorJobIds } },
        data: { canonicalJobId: null },
      });
      await prisma.emailMessage.updateMany({
        where: { jobId: { in: priorJobIds } },
        data: { jobId: null },
      });
      await prisma.jobActivityLog.deleteMany({
        where: { jobId: { in: priorJobIds } },
      });
      await prisma.entityAlias.deleteMany({
        where: { jobId: { in: priorJobIds } },
      });
    }
    await prisma.bidCandidate.deleteMany({
      where: { workspaceId, proposedProjectName: { startsWith: MARKER } },
    });
    if (priorJobIds.length > 0) {
      await prisma.job.deleteMany({ where: { id: { in: priorJobIds } } });
    }
    if (priorMsgIds.length > 0) {
      await prisma.emailMessage.deleteMany({
        where: { id: { in: priorMsgIds } },
      });
    }
    if (priorThreadIds.length > 0) {
      await prisma.emailThread.deleteMany({
        where: { id: { in: priorThreadIds } },
      });
    }
    steps.push("cleaned_prior_fixtures");

    const thread = await prisma.emailThread.create({
      data: {
        workspaceId,
        inboxConnectionId,
        gmailThreadId: `phase7-thread-${Date.now()}`,
        providerThreadId: `phase7-thread-${Date.now()}`,
        subject: `${MARKER} Bid Invite`,
        messageCount: 0,
      },
      select: { id: true },
    });

    const invite = await prisma.emailMessage.create({
      data: {
        workspaceId,
        inboxConnectionId,
        threadId: thread.id,
        gmailMessageId: `phase7-invite-${Date.now()}`,
        gmailThreadId: thread.id,
        providerMessageId: `phase7-invite-${Date.now()}`,
        subject: `${MARKER} Bid Invite Falcon`,
        senderEmail: "gc@example.test",
        senderName: "Test GC",
        toAddresses: [{ email: "estimator@example.test" }],
        direction: "RECEIVED",
        bodyText: "Invitation to bid — beams and columns.",
        sentAt: new Date("2026-09-01T12:00:00Z"),
        receivedAt: new Date("2026-09-01T12:00:00Z"),
        classificationStatus: "CLASSIFIED",
        mailboxCategory: "BUSINESS",
      },
      select: { id: true },
    });

    const quoteMsg = await prisma.emailMessage.create({
      data: {
        workspaceId,
        inboxConnectionId,
        threadId: thread.id,
        gmailMessageId: `phase7-quote-${Date.now()}`,
        gmailThreadId: thread.id,
        providerMessageId: `phase7-quote-${Date.now()}`,
        subject: `${MARKER} Quote Falcon Rev1`,
        senderEmail: "vendor@example.test",
        senderName: "Vendor",
        toAddresses: [{ email: "estimator@example.test" }],
        direction: "SENT",
        composedInForgeOps: true,
        bodyText: "Quote for stairs and railings $12000",
        sentAt: new Date("2026-09-10T12:00:00Z"),
        receivedAt: new Date("2026-09-10T12:00:00Z"),
        classificationStatus: "CLASSIFIED",
        mailboxCategory: "BUSINESS",
      },
      select: { id: true },
    });

    await prisma.classification.create({
      data: {
        workspaceId,
        threadId: thread.id,
        messageId: invite.id,
        businessCategory: "BUSINESS",
        mailboxCategory: "BUSINESS",
        emailType: "FYI_UPDATE",
        businessTypeKey: "BID_OPPORTUNITY",
        confidence: 1,
        routingHints: {
          authority: "SYSTEM_DETERMINISTIC",
          source: "bid_invites_folder",
          deterministic: true,
        },
        processedAt: new Date(),
        modelName: "phase7-fixture",
        modelVersion: "v1",
      },
    });
    await prisma.classification.create({
      data: {
        workspaceId,
        threadId: thread.id,
        messageId: quoteMsg.id,
        businessCategory: "BUSINESS",
        mailboxCategory: "BUSINESS",
        emailType: "FYI_UPDATE",
        businessTypeKey: "ESTIMATE_QUOTE",
        confidence: 1,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        routingHints: {
          authority: "USER_EXPLICIT",
          source: "forgeops_compose",
          composedInForgeOps: true,
        },
        processedAt: new Date(),
        modelName: "user-explicit",
        modelVersion: "v1",
      },
    });

    const candidate = await prisma.bidCandidate.create({
      data: {
        workspaceId,
        identityKey: `phase7:${Date.now()}`,
        status: "READY",
        lifecycle: "OPEN",
        proposedProjectName: `${MARKER} Falcon Elementary`,
        proposedCustomerName: "Mortenson Test",
        proposedBidDueAt: new Date("2026-10-22T00:00:00Z"),
        anticipatedStartAt: new Date("2027-01-15T00:00:00Z"),
        proposedJobNumber: "EXT-PHASE7",
        proposedScope: "Beams, Columns, Stairs",
        proposedNotes: "Business note for Phase7",
        emails: {
          create: [
            {
              workspaceId,
              emailMessageId: invite.id,
              role: "BID_INVITE",
              isPrimary: true,
              matchEvidence: {
                labels: ["user_confirmed", "manual_assign"],
                userConfirmed: true,
              },
            },
            {
              workspaceId,
              emailMessageId: quoteMsg.id,
              role: "QUOTE",
              isPrimary: false,
              matchEvidence: {
                labels: ["user_confirmed", "manual_assign"],
                userConfirmed: true,
              },
            },
          ],
        },
        quoteStagings: {
          create: {
            workspaceId,
            inboxConnectionId,
            emailMessageId: quoteMsg.id,
            sourceSubject: `${MARKER} Quote Falcon Rev1`,
            displayName: "Rev 1",
            extractedAmount: 12000,
            currency: "USD",
            extractedScope: "Stairs, Railings",
            matchStatus: "MATCHED",
            isDurable: true,
            userConfirmedMatch: true,
          },
        },
      },
      select: { id: true },
    });

    await prisma.bidCandidate.update({
      where: { id: candidate.id },
      data: { lifecycle: "QUOTED" },
    });
    steps.push("created_quoted_candidate_with_invite_and_quote");

    // Preview must not mutate
    const beforePreview = await prisma.bidCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { lifecycle: true, canonicalJobId: true },
    });
    const jobsBeforePreview = await prisma.job.count({
      where: { workspaceId, name: { startsWith: MARKER } },
    });
    const preview = await previewConvertBidCandidateToJob({
      prisma,
      workspaceId,
      candidateId: candidate.id,
    });
    const afterPreview = await prisma.bidCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { lifecycle: true, canonicalJobId: true },
    });
    const jobsAfterPreview = await prisma.job.count({
      where: { workspaceId, name: { startsWith: MARKER } },
    });
    if (
      beforePreview.lifecycle !== afterPreview.lifecycle ||
      beforePreview.canonicalJobId !== afterPreview.canonicalJobId ||
      jobsBeforePreview !== jobsAfterPreview
    ) {
      throw new Error("Preview mutated Candidate/Job state");
    }
    if (!preview.convertible) {
      throw new Error(`Preview not convertible: ${JSON.stringify(preview)}`);
    }
    // Empty workspace: suggestNextJobNumberForWorkspace returns null — user must enter.
    const jobNumber = preview.suggestedJobNumber?.trim() || "P7-1001";
    if (!preview.suggestedJobNumber) {
      steps.push("preview_suggestedJobNumber_null_empty_workspace_fallback_P7-1001");
    }
    if (preview.startDate?.includes("2027-01-15") !== true) {
      throw new Error("Preview startDate missing anticipated start");
    }
    if (preview.bidDueAt?.includes("2026-10-22") !== true) {
      throw new Error("Preview bidDueAt missing");
    }
    steps.push(`preview_ok jobNumber=${jobNumber}`);

    const convert1 = await convertBidCandidateToJob({
      prisma,
      workspaceId,
      candidateId: candidate.id,
      userId,
      jobNumber,
      projectName: `${MARKER} Falcon Elementary`,
    });
    if (!convert1.created || convert1.jobStatus !== "ACTIVE") {
      throw new Error(`Unexpected convert1: ${JSON.stringify(convert1)}`);
    }
    steps.push(`convert1_ok job=${convert1.jobId} #${convert1.jobNumber}`);

    const convert2 = await convertBidCandidateToJob({
      prisma,
      workspaceId,
      candidateId: candidate.id,
      userId,
      jobNumber: "SHOULD-NOT-CREATE",
    });
    if (convert2.created || !convert2.reused || convert2.jobId !== convert1.jobId) {
      throw new Error(`Idempotency failed: ${JSON.stringify(convert2)}`);
    }
    steps.push("idempotent_reuse_ok");

    const job = await prisma.job.findUniqueOrThrow({
      where: { id: convert1.jobId },
      select: {
        status: true,
        jobNumber: true,
        name: true,
        startDate: true,
        bidDueAt: true,
        description: true,
        notes: true,
        externalRef: true,
        assignedEmails: { select: { id: true, subject: true } },
      },
    });
    if (job.status !== "ACTIVE") throw new Error(`Job status ${job.status}`);
    if (job.jobNumber !== jobNumber) throw new Error("Job number mismatch");
    if (job.externalRef !== "EXT-PHASE7") throw new Error("externalRef not carried");
    if (!job.startDate || job.startDate.toISOString().includes("2027-01-15") !== true) {
      throw new Error("startDate not from anticipatedStartAt");
    }
    if (
      job.bidDueAt &&
      job.startDate &&
      job.bidDueAt.getTime() === job.startDate.getTime()
    ) {
      throw new Error("bidDue equals startDate");
    }
    const emailIds = new Set(job.assignedEmails.map((e) => e.id));
    if (!emailIds.has(invite.id) || !emailIds.has(quoteMsg.id)) {
      throw new Error("Invite/Quote not associated to Job");
    }
    steps.push("carryforward_ok");

    // JOB_NUMBER_TAKEN on a second candidate
    const cand2 = await prisma.bidCandidate.create({
      data: {
        workspaceId,
        identityKey: `phase7:b:${Date.now()}`,
        status: "READY",
        lifecycle: "OPEN",
        proposedProjectName: `${MARKER} Second Project`,
      },
      select: { id: true },
    });
    let conflictCode: string | null = null;
    try {
      await convertBidCandidateToJob({
        prisma,
        workspaceId,
        candidateId: cand2.id,
        userId,
        jobNumber,
      });
    } catch (e) {
      conflictCode =
        e instanceof Error && "code" in e
          ? String((e as { code: string }).code)
          : null;
    }
    if (conflictCode !== "JOB_NUMBER_TAKEN") {
      throw new Error(`Expected JOB_NUMBER_TAKEN, got ${conflictCode}`);
    }
    const cand2After = await prisma.bidCandidate.findUniqueOrThrow({
      where: { id: cand2.id },
      select: { lifecycle: true, canonicalJobId: true },
    });
    if (cand2After.lifecycle !== "OPEN" || cand2After.canonicalJobId) {
      throw new Error("Conflict incorrectly converted second candidate");
    }
    steps.push(`job_number_conflict_ok code=${conflictCode}`);

    // Clear Analysis must retain durable Candidate/Job/emails
    const clear = await clearBiddingAnalysisStaging({
      prisma,
      workspaceId,
      connectionId: inboxConnectionId,
    });
    const stillCand = await prisma.bidCandidate.findUnique({
      where: { id: candidate.id },
    });
    const stillJob = await prisma.job.findUnique({ where: { id: convert1.jobId } });
    const stillInvite = await prisma.emailMessage.findUnique({
      where: { id: invite.id },
    });
    const linkCount = await prisma.bidCandidateEmail.count({
      where: { bidCandidateId: candidate.id },
    });
    if (!stillCand || !stillJob || !stillInvite || linkCount < 2) {
      throw new Error(
        `Clear Analysis deleted durable data: ${JSON.stringify({ stillCand: !!stillCand, stillJob: !!stillJob, stillInvite: !!stillInvite, linkCount, clear })}`
      );
    }
    steps.push(
      `clear_analysis_retained durableQuotes=${clear.durableQuotesRetained}`
    );

    // Authority still USER_EXPLICIT on quote
    const quoteClass = await prisma.classification.findFirst({
      where: { messageId: quoteMsg.id },
      select: { businessTypeKey: true, routingHints: true },
    });
    const hints = quoteClass?.routingHints as { authority?: string } | null;
    if (
      quoteClass?.businessTypeKey !== "ESTIMATE_QUOTE" ||
      hints?.authority !== "USER_EXPLICIT"
    ) {
      throw new Error(`Quote authority lost: ${JSON.stringify(quoteClass)}`);
    }
    steps.push("classification_authority_retained");

    report.preview = {
      suggestedJobNumber: preview.suggestedJobNumber,
      emailCount: preview.emailCount,
      quoteCount: preview.quoteCount,
    };
    report.convert = {
      jobId: convert1.jobId,
      jobNumber: convert1.jobNumber,
      status: job.status,
      emailCount: job.assignedEmails.length,
    };
    report.clear = clear;

    // Cleanup fixtures (FK-safe).
    await prisma.bidCandidateEmail.deleteMany({
      where: { emailMessageId: { in: [invite.id, quoteMsg.id] } },
    });
    await prisma.bidQuoteStaging.deleteMany({
      where: { emailMessageId: { in: [invite.id, quoteMsg.id] } },
    });
    await prisma.classification.deleteMany({
      where: { messageId: { in: [invite.id, quoteMsg.id] } },
    });
    await prisma.bidCandidate.updateMany({
      where: { id: { in: [candidate.id, cand2.id] } },
      data: { canonicalJobId: null },
    });
    await prisma.emailMessage.updateMany({
      where: { id: { in: [invite.id, quoteMsg.id] } },
      data: { jobId: null },
    });
    await prisma.jobActivityLog.deleteMany({
      where: { jobId: convert1.jobId },
    });
    await prisma.entityAlias.deleteMany({ where: { jobId: convert1.jobId } });
    await prisma.bidCandidate.deleteMany({
      where: { workspaceId, proposedProjectName: { startsWith: MARKER } },
    });
    await prisma.job.deleteMany({ where: { id: convert1.jobId } });
    await prisma.emailMessage.deleteMany({
      where: { id: { in: [invite.id, quoteMsg.id] } },
    });
    await prisma.emailThread.deleteMany({ where: { id: thread.id } });
    steps.push("fixtures_cleaned");

    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    report.ok = false;
    report.error = e instanceof Error ? e.message : String(e);
    try {
      const orphanMsgs = await prisma.emailMessage.findMany({
        where: { subject: { startsWith: MARKER } },
        select: { id: true, threadId: true },
      });
      const ids = orphanMsgs.map((m) => m.id);
      if (ids.length) {
        await prisma.bidCandidateEmail.deleteMany({
          where: { emailMessageId: { in: ids } },
        });
        await prisma.bidQuoteStaging.deleteMany({
          where: { emailMessageId: { in: ids } },
        });
        await prisma.classification.deleteMany({
          where: { messageId: { in: ids } },
        });
      }
      await prisma.bidCandidate.deleteMany({
        where: { proposedProjectName: { startsWith: MARKER } },
      });
      await prisma.job.deleteMany({ where: { name: { startsWith: MARKER } } });
      if (ids.length) {
        await prisma.emailMessage.deleteMany({ where: { id: { in: ids } } });
        await prisma.emailThread.deleteMany({
          where: { id: { in: [...new Set(orphanMsgs.map((m) => m.threadId))] } },
        });
      }
      steps.push("fixtures_cleaned_after_error");
    } catch {
      /* ignore cleanup errors */
    }
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
