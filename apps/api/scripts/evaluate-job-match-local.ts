/**
 * LOCAL ONLY holdout evaluation of the Job matcher against forgeops_dev.
 * Read-only. Does not persist matcher decisions or mutate contacts/threads.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  authoritativeEmailAssignmentOr,
  JOB_NAME_MARKER_ELIGIBLE_STATUSES,
  scoreJobMatchGroundTruth,
  type JobMatchGroundTruthRow,
} from "@forgeops/shared";
import { createJobMatcherService } from "../src/application/services/prisma-job-match-loader.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function assertLocalDev(): void {
  const appEnv = process.env.APP_ENV ?? "development";
  if (appEnv !== "development" && appEnv !== "dev" && appEnv !== "local") {
    throw new Error(`Refusing job-match eval: APP_ENV=${appEnv}`);
  }
  const db = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(db) || !/forgeops_dev/.test(db)) {
    throw new Error(
      "Refusing job-match eval: DATABASE_URL is not local forgeops_dev"
    );
  }
  if (/railway|amazonaws|neon\.tech|supabase/i.test(db)) {
    throw new Error("Refusing job-match eval: DATABASE_URL looks remote");
  }
}

async function main(): Promise<void> {
  loadDotEnv(path.resolve(repoRoot, ".env"));
  loadDotEnv(path.resolve(repoRoot, "packages/db/.env"));
  loadDotEnv(path.resolve(repoRoot, "apps/api/.env"));
  assertLocalDev();

  const prisma = new PrismaClient();
  const matcher = createJobMatcherService(prisma);
  const eligible = [...JOB_NAME_MARKER_ELIGIBLE_STATUSES];

  try {
    const totalAuthoritative = await prisma.emailMessage.count({
      where: {
        jobId: { not: null },
        OR: authoritativeEmailAssignmentOr(),
        job: {
          status: { in: eligible },
          archivedAt: null,
        },
      },
    });

    const emails = await prisma.emailMessage.findMany({
      where: {
        jobId: { not: null },
        OR: authoritativeEmailAssignmentOr(),
        job: {
          status: { in: eligible },
          archivedAt: null,
        },
      },
      select: {
        id: true,
        workspaceId: true,
        inboxConnectionId: true,
        providerThreadId: true,
        subject: true,
        senderEmail: true,
        bodyText: true,
        jobId: true,
        normalizedEmail: {
          select: { cleanTextBody: true, normalizedSubject: true, senderDomain: true },
        },
      },
      orderBy: { receivedAt: "desc" },
      take: 300,
    });

    console.log(
      JSON.stringify(
        {
          database: "local forgeops_dev",
          autoAssignEnabled: process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED ?? "(unset)",
          eligibleAuthoritativeCount: totalAuthoritative,
          evaluated: emails.length,
        },
        null,
        2
      )
    );

    if (emails.length === 0) {
      console.log(
        "Insufficient ground truth: 0 authoritative eligible Job emails. No metrics fabricated."
      );
      return;
    }

    const rows: JobMatchGroundTruthRow[] = [];
    for (const email of emails) {
      if (!email.jobId) continue;
      const result = await matcher.match({
        workspaceId: email.workspaceId,
        emailMessageId: email.id,
        inboxConnectionId: email.inboxConnectionId,
        subject: email.subject,
        normalizedSubject: email.normalizedEmail?.normalizedSubject,
        bodyText: email.bodyText,
        cleanBody: email.normalizedEmail?.cleanTextBody ?? email.bodyText,
        senderEmail: email.senderEmail,
        senderDomain: email.normalizedEmail?.senderDomain,
        providerThreadId: email.providerThreadId,
      });
      rows.push({
        id: email.id,
        subject: email.subject,
        senderEmail: email.senderEmail,
        trueJobId: email.jobId,
        result,
      });
    }

    const report = scoreJobMatchGroundTruth(rows);
    console.log(
      JSON.stringify(
        {
          TOTAL_ELIGIBLE: report.total,
          CORRECT_MATCH: report.correctMatch,
          INCORRECT_MATCH: report.incorrectMatch,
          AMBIGUOUS: report.ambiguous,
          CONFLICT: report.conflict,
          NO_MATCH: report.noMatch,
          PRECISION: report.precision,
          DECISION_COVERAGE: report.decisionCoverage,
          CORRECT_COVERAGE: report.correctCoverage,
          FALSE_MATCH_RATE: report.falseMatchRate,
          AMBIGUITY_RATE: report.ambiguityRate,
          CONFLICT_RATE: report.conflictRate,
          NO_MATCH_RATE: report.noMatchRate,
          marker1UniqueStrongMatches: report.marker1UniqueStrongMatches,
          marker1AmbiguousSets: report.marker1AmbiguousSets,
          avgMarker1CandidateCount: report.avgMarker1CandidateCount,
          marker2UniqueResolutions: report.marker2UniqueResolutions,
          marker2AmbiguityNarrowingCount: report.narrowedByMarker2,
          avgAfterMarker2: report.avgAfterMarker2,
          marker3UniqueResolutions: report.marker3UniqueResolutions,
          marker3AmbiguityNarrowingCount: report.narrowedByMarker3,
          avgAfterMarker3: report.avgAfterMarker3,
          signalConflicts: report.signalConflicts,
          incorrectNarrowing: report.incorrectNarrowing,
          representativeFailures: report.representativeFailures,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
