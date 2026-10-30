import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { authoritativeEmailAssignmentOr, isHistoricalEvalGroundTruth } from "@forgeops/shared";
import {
  findEvalWorkspace,
  loadHistoricalEvalDatasetSummary,
  loadHistoricalEvalEmailsPage,
  loadJobMatchEvalSnapshot,
  type JobMatchEvalReadDb,
} from "../application/services/job-match-eval-read.js";

const here = dirname(fileURLToPath(import.meta.url));

type WhereQuery = {
  where: Record<string, unknown>;
  by?: string[];
};

function readSrc(...parts: string[]): string {
  return readFileSync(resolve(here, ...parts), "utf8");
}

describe("production evaluator is operator-only and read-only", () => {
  const sources = [
    readSrc("../scripts/evaluate-job-matcher-production.ts"),
    readSrc("../application/services/job-match-eval-read.ts"),
    readSrc("../application/services/read-only-prisma.ts"),
  ].join("\n");

  it("does not import persistence, contact learning, queues, providers, or AI", () => {
    expect(sources).not.toMatch(/persist-job-match|persistJobMatchResult/);
    expect(sources).not.toMatch(/learn-job-contact-from-email|learnJobContact/);
    expect(sources).not.toMatch(/prisma-job-match-loader/);
    expect(sources).not.toMatch(/from ["'].*queues/);
    expect(sources).not.toMatch(/googleapis|@aws-sdk\/client-s3|openai/i);
    expect(sources).not.toMatch(/JOB_MATCHER_AUTO_ASSIGN_ENABLED\s*=/);
    expect(sources).not.toMatch(/emailMessage\.(create|update|delete)/);
    expect(sources).not.toMatch(/jobEmailContact\.(create|update|delete)/);
    expect(sources).not.toMatch(/\$executeRaw/);
  });

  it("uses the read-only Prisma guard and evaluation eligibility", () => {
    expect(sources).toContain("createReadOnlyPrisma");
    expect(sources).toContain('eligibilityMode: "evaluation"');
    expect(sources).toContain("emailMessageId: email.id");
    expect(sources).toContain("isHistoricalEvalGroundTruth");
    expect(sources).toContain("createJobMatchEvalLoaderFromSnapshot");
  });
});

describe("historical eval read path", () => {
  it("validates workspace, isolates snapshot, and excludes JOB_NUMBER_MATCH from eval pages", async () => {
    const emails = [
      {
        id: "m1",
        workspaceId: "ws-1",
        jobId: "job-1",
        subject: "RFI",
        snippet: "see drawings",
        senderEmail: "a@b.com",
        direction: "RECEIVED" as const,
        inboxConnectionId: "c1",
        providerThreadId: "t1",
        jobAssignmentIsManual: true,
        jobAssignmentSource: "USER_ASSIGNED",
        hasAttachments: false,
        normalizedEmail: { cleanTextBody: "please review Alleghany Apartments" },
      },
      {
        id: "m2",
        workspaceId: "ws-1",
        jobId: "job-1",
        subject: "PO 1001",
        snippet: "job 1001",
        senderEmail: "a@b.com",
        direction: "SENT" as const,
        inboxConnectionId: "c1",
        providerThreadId: "t1",
        jobAssignmentIsManual: false,
        jobAssignmentSource: "JOB_NUMBER_MATCH",
        hasAttachments: false,
        normalizedEmail: null,
      },
    ];
    const db = {
      workspace: {
        findFirst: async ({ where }: WhereQuery) =>
          where.id === "ws-1" ? { id: "ws-1", name: "Acme" } : null,
      },
      job: {
        findFirst: async ({ where }: WhereQuery) =>
          where.id === "job-1" && where.workspaceId === "ws-1"
            ? { id: "job-1" }
            : null,
        findMany: async ({ where }: WhereQuery) => {
          if (where.workspaceId !== "ws-1") return [];
          return [
            {
              id: "job-1",
              jobNumber: "1001",
              name: "Alleghany Apartments",
              normalizedName: "alleghany apartments",
              customerId: null,
              externalRef: null,
              siteName: null,
              description: null,
              status: "COMPLETE",
            },
          ];
        },
      },
      entityAlias: {
        findMany: async ({ where }: WhereQuery) =>
          where.workspaceId === "ws-1"
            ? [
                {
                  id: "al-1",
                  jobId: "job-1",
                  alias: "Alleghany Apts",
                  normalizedAlias: "alleghany apts",
                },
              ]
            : [],
      },
      jobEmailContact: {
        findMany: async ({ where }: WhereQuery) =>
          where.workspaceId === "ws-1"
            ? [
                {
                  id: "jec-1",
                  jobId: "job-1",
                  source: "MANUAL",
                  contact: { email: "a@b.com", normalizedEmail: "a@b.com" },
                },
              ]
            : [],
      },
      emailMessage: {
        count: async ({ where }: WhereQuery) => {
          if (where.OR) return 1;
          if (where.jobId) return 2;
          return 3;
        },
        groupBy: async ({ by }: WhereQuery) => {
          if (!by) return [];
          if (by[0] === "jobAssignmentSource") {
            return [
              { jobAssignmentSource: "USER_ASSIGNED", _count: { _all: 1 } },
              { jobAssignmentSource: "JOB_NUMBER_MATCH", _count: { _all: 1 } },
            ];
          }
          if (by[0] === "direction") {
            return [
              { direction: "RECEIVED", _count: { _all: 1 } },
              { direction: "SENT", _count: { _all: 0 } },
            ];
          }
          if (by[0] === "inboxConnectionId") {
            return [{ inboxConnectionId: "c1", _count: { _all: 1 } }];
          }
          if (by[0] === "jobId") {
            return [{ jobId: "job-1", _count: { _all: 1 } }];
          }
          return [];
        },
        findMany: async ({ where }: WhereQuery) => {
          if (where.workspaceId !== "ws-1") return [];
          const auth = Boolean(where.OR);
          return emails
            .filter((row) => {
              if (!auth) return true;
              return (
                row.jobAssignmentIsManual === true ||
                row.jobAssignmentSource === "USER_ASSIGNED" ||
                row.jobAssignmentSource === "VERIFIED_PROJECT_FOLDER"
              );
            })
            .map((row) => ({ ...row }));
        },
      },
    } as unknown as JobMatchEvalReadDb;

    expect(await findEvalWorkspace(db, "ws-missing")).toBeNull();
    const workspace = await findEvalWorkspace(db, "ws-1");
    expect(workspace?.name).toBe("Acme");

    const summary = await loadHistoricalEvalDatasetSummary(db, workspace!);
    expect(summary.authoritativeEmails).toBe(1);
    expect(summary.jobLinkedEmails).toBe(2);
    expect(summary.countsByAssignmentSource.JOB_NUMBER_MATCH).toBe(1);
    expect(summary.countsByJobStatus.COMPLETE).toBe(1);

    const snapshot = await loadJobMatchEvalSnapshot(db, "ws-1");
    expect(snapshot.jobs[0]?.status).toBe("COMPLETE");
    expect(snapshot.authoritativeEmails.map((row) => row.id)).toEqual(["m1"]);
    expect(
      snapshot.authoritativeEmails.every((row) =>
        isHistoricalEvalGroundTruth(row)
      )
    ).toBe(true);

    const page = await loadHistoricalEvalEmailsPage(db, {
      workspaceId: "ws-1",
      take: 50,
    });
    expect(page.map((row) => row.id)).toEqual(["m1"]);
    expect(page[0]?.cleanBody).toContain("Alleghany");
    expect(JSON.stringify(page)).not.toContain("bodyHtml");
  });

  it("authoritativeEmailAssignmentOr matches the evaluator ground-truth helper", () => {
    const or = authoritativeEmailAssignmentOr();
    expect(or).toEqual(
      expect.arrayContaining([
        { jobAssignmentIsManual: true },
        { jobAssignmentSource: "USER_ASSIGNED" },
        { jobAssignmentSource: "VERIFIED_PROJECT_FOLDER" },
      ])
    );
    expect(JSON.stringify(or)).not.toContain("JOB_NUMBER_MATCH");
    expect(JSON.stringify(or)).not.toContain("AI_SUGGESTED");
  });
});
