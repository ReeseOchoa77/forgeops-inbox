/**
 * Read-only single-email Job Matcher test for Intelligence UI.
 * Uses evaluation eligibility + holdout. Never persists.
 */
import {
  JobMatcherService,
  classifyHistoricalEvalOutcome,
  createJobMatchEvalLoaderFromSnapshot,
  isHistoricalEvalGroundTruth,
  resolvingMarkerForResult,
} from "@forgeops/shared";
import type { PrismaClient } from "@prisma/client";
import { loadJobMatchEvalSnapshot } from "./job-match-eval-read.js";

export async function runJobMatcherTestOne(input: {
  prisma: PrismaClient;
  workspaceId: string;
  emailMessageId: string;
}) {
  const email = await input.prisma.emailMessage.findFirst({
    where: { id: input.emailMessageId, workspaceId: input.workspaceId },
    select: {
      id: true,
      subject: true,
      snippet: true,
      senderEmail: true,
      providerThreadId: true,
      inboxConnectionId: true,
      jobId: true,
      jobAssignmentIsManual: true,
      jobAssignmentSource: true,
      direction: true,
      normalizedEmail: { select: { cleanTextBody: true } },
    },
  });
  if (!email) {
    throw new Error("Email not found in workspace");
  }

  const snapshot = await loadJobMatchEvalSnapshot(input.prisma, input.workspaceId);
  const matcher = new JobMatcherService(
    createJobMatchEvalLoaderFromSnapshot(snapshot),
    null,
    { logCompletions: false }
  );

  const result = await matcher.match({
    workspaceId: input.workspaceId,
    emailMessageId: email.id,
    inboxConnectionId: email.inboxConnectionId,
    subject: email.subject,
    cleanBody: email.normalizedEmail?.cleanTextBody ?? email.snippet ?? null,
    senderEmail: email.senderEmail,
    providerThreadId: email.providerThreadId,
    eligibilityMode: "evaluation",
  });

  const jobsById = new Map(snapshot.jobs.map((j) => [j.id, j]));
  const predicted = result.selectedJobId
    ? jobsById.get(result.selectedJobId)
    : undefined;
  const actual = email.jobId ? jobsById.get(email.jobId) : undefined;
  const authoritative = isHistoricalEvalGroundTruth(email);
  const outcome =
    authoritative && email.jobId
      ? classifyHistoricalEvalOutcome({
          trueJobId: email.jobId,
          result,
        })
      : null;

  return {
    intelligenceId: "job-matcher" as const,
    databaseWrites: "NONE" as const,
    email: {
      id: email.id,
      subject: email.subject,
      senderEmail: email.senderEmail,
      direction: email.direction,
      jobId: email.jobId,
      jobAssignmentSource: email.jobAssignmentSource,
    },
    result: {
      decision: result.decision,
      selectedJobId: result.selectedJobId,
      selectedJobName: predicted?.name ?? null,
      confidence: result.confidence,
      evidence: result.evidence,
      markerTrace: result.markerTrace ?? [],
      matcherVersion: result.matcherVersion,
      resolvingMarker: resolvingMarkerForResult(result),
    },
    historical: {
      jobId: email.jobId,
      jobName: actual?.name ?? null,
      authoritativeGroundTruth: authoritative,
      outcome,
    },
  };
}
