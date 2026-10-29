import { beforeEach, describe, expect, it, vi } from "vitest";

const learnJobContactsFromEmails = vi.hoisted(() =>
  vi.fn(async () => ({ learned: 0, skipped: 0 }))
);

vi.mock("@forgeops/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@forgeops/shared")>();
  return {
    ...actual,
    learnJobContactsFromEmails,
  };
});

import {
  associateBidImportEmails,
  collectBidCandidateImportEmailIds,
} from "../application/services/associate-bid-import-emails.js";

describe("collectBidCandidateImportEmailIds", () => {
  it("unions invite links and MATCHED quote emails only", async () => {
    const prisma = {
      bidCandidateEmail: {
        findMany: vi.fn(async () => [
          { emailMessageId: "invite-1", role: "BID_INVITE" },
          { emailMessageId: "addendum-1", role: "ADDENDUM" },
          { emailMessageId: "quote-ambiguous", role: "QUOTE" },
        ]),
      },
      bidQuoteStaging: {
        findMany: vi.fn(async () => [
          { emailMessageId: "quote-1" },
          { emailMessageId: "invite-1" },
        ]),
      },
    };
    const ids = await collectBidCandidateImportEmailIds(prisma as never, {
      workspaceId: "ws",
      candidateId: "c1",
    });
    expect(ids.sort()).toEqual(["addendum-1", "invite-1", "quote-1"]);
    expect(ids).not.toContain("quote-ambiguous");
  });

  it("excludes NEEDS_REVIEW / POSSIBLE_MATCH quotes from import evidence", async () => {
    const prisma = {
      bidCandidateEmail: {
        findMany: vi.fn(async () => [
          { emailMessageId: "invite-1", role: "BID_INVITE" },
        ]),
      },
      bidQuoteStaging: {
        // Service filters to MATCHED only — mock returns empty as DB would.
        findMany: vi.fn(async () => []),
      },
    };
    const ids = await collectBidCandidateImportEmailIds(prisma as never, {
      workspaceId: "ws",
      candidateId: "c1",
    });
    expect(ids).toEqual(["invite-1"]);
    expect(prisma.bidQuoteStaging.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matchStatus: { in: ["MATCHED"] },
        }),
      })
    );
  });
});

describe("associateBidImportEmails", () => {
  beforeEach(() => {
    learnJobContactsFromEmails.mockClear();
  });

  it("assigns unassigned emails and skips same-job idempotently", async () => {
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "em-new",
            jobId: null,
            jobAssignmentIsManual: false,
            jobAssignmentSource: null,
          },
          {
            id: "em-same",
            jobId: "job-1",
            jobAssignmentIsManual: true,
            jobAssignmentSource: "USER_ASSIGNED",
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const result = await associateBidImportEmails({
      prisma: prisma as never,
      workspaceId: "ws",
      jobId: "job-1",
      userId: "u1",
      emailMessageIds: ["em-new", "em-same"],
    });
    expect(result.attachedEmailIds).toEqual(["em-new"]);
    expect(result.skippedUnchanged).toEqual(["em-same"]);
    expect(result.conflicts).toEqual([]);
    expect(prisma.emailMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["em-new"] } }),
        data: expect.objectContaining({
          jobId: "job-1",
          jobAssignmentSource: "USER_ASSIGNED",
        }),
      })
    );
    expect(learnJobContactsFromEmails).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        workspaceId: "ws",
        emailMessageIds: ["em-new"],
      })
    );
  });

  it("does not overwrite protected assignment on a different Job", async () => {
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "em-x",
            jobId: "job-other",
            jobAssignmentIsManual: true,
            jobAssignmentSource: "USER_ASSIGNED",
          },
          {
            id: "em-v",
            jobId: "job-folder",
            jobAssignmentIsManual: false,
            jobAssignmentSource: "VERIFIED_PROJECT_FOLDER",
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const result = await associateBidImportEmails({
      prisma: prisma as never,
      workspaceId: "ws",
      jobId: "job-import",
      userId: "u1",
      emailMessageIds: ["em-x", "em-v"],
    });
    expect(result.attachedEmailIds).toEqual([]);
    expect(result.conflicts).toHaveLength(2);
    expect(prisma.emailMessage.updateMany).not.toHaveBeenCalled();
    expect(learnJobContactsFromEmails).not.toHaveBeenCalled();
  });

  it("may overwrite weak AI assignment on a different Job", async () => {
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "em-ai",
            jobId: "job-old",
            jobAssignmentIsManual: false,
            jobAssignmentSource: "AI_AUTO_ASSIGNED",
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const result = await associateBidImportEmails({
      prisma: prisma as never,
      workspaceId: "ws",
      jobId: "job-import",
      userId: "u1",
      emailMessageIds: ["em-ai"],
    });
    expect(result.attachedEmailIds).toEqual(["em-ai"]);
    expect(result.conflicts).toEqual([]);
  });
});
