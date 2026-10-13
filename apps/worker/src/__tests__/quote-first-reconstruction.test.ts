import { describe, expect, it, vi } from "vitest";
import { emptyBidEmailAnalyzeProgress } from "@forgeops/shared";
import {
  groupQuotesIntoProjects,
  reconstructCandidatesFromQuoteGroups,
} from "../application/services/quote-first-reconstruction.js";

function basePrisma() {
  return {
    bidAnalysisRun: { update: vi.fn(async () => ({})) },
    bidQuoteStaging: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    bidFolderDiscoveryEmail: {
      findMany: vi.fn(async () => []),
    },
    emailMessage: {
      findMany: vi.fn(async () => []),
    },
    bidCandidate: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { id?: string; identityKey: string } }) => ({
        id: "cand-1",
        ...data,
      })),
      update: vi.fn(async () => ({})),
    },
    bidCandidateEmail: {
      upsert: vi.fn(async () => ({})),
    },
  };
}

describe("quote-first reconstruction", () => {
  it("groups Quote revisions into one project", async () => {
    const progress = emptyBidEmailAnalyzeProgress();
    const prisma = basePrisma();
    prisma.bidQuoteStaging.findMany = vi.fn(async () => [
      {
        id: "qs1",
        emailMessageId: "em-q1",
        displayName: "Project Alpha Quote",
        extractedScope: null,
        extractedScopeDetail: null,
        extractedAmount: 180000,
        extractedNotes: null,
        userConfirmedMatch: false,
        userEditedFields: null,
        matchStatus: "UNMATCHED",
        emailMessage: {
          id: "em-q1",
          subject: "Project Alpha Quote",
          bodyText: "Quote for Project Alpha",
          senderName: "Mortenson",
          attachmentMetadata: [],
          receivedAt: new Date("2026-01-12"),
        },
      },
      {
        id: "qs2",
        emailMessageId: "em-q2",
        displayName: "Project Alpha Revised Quote",
        extractedScope: null,
        extractedScopeDetail: null,
        extractedAmount: 187500,
        extractedNotes: null,
        userConfirmedMatch: false,
        userEditedFields: null,
        matchStatus: "UNMATCHED",
        emailMessage: {
          id: "em-q2",
          subject: "Project Alpha Revised Quote",
          bodyText: "Revised quote Project Alpha",
          senderName: "Mortenson",
          attachmentMetadata: [],
          receivedAt: new Date("2026-01-20"),
        },
      },
      {
        id: "qs3",
        emailMessageId: "em-q3",
        displayName: "Project Alpha Rev 2",
        extractedScope: null,
        extractedScopeDetail: null,
        extractedAmount: 190000,
        extractedNotes: null,
        userConfirmedMatch: false,
        userEditedFields: null,
        matchStatus: "UNMATCHED",
        emailMessage: {
          id: "em-q3",
          subject: "Project Alpha Rev 2",
          bodyText: "Rev 2 Project Alpha",
          senderName: "Mortenson",
          attachmentMetadata: [],
          receivedAt: new Date("2026-01-28"),
        },
      },
    ]);

    const groups = await groupQuotesIntoProjects({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.quoteRows).toHaveLength(3);
    expect(progress.quoteProjectsIdentified).toBe(1);
  });

  it("matches Bid Invite that predates Quote range", async () => {
    const progress = emptyBidEmailAnalyzeProgress();
    const prisma = basePrisma();
    const groups = [
      {
        groupKey: "qname:north memorial expansion|cust:mortenson",
        projectName: "North Memorial Expansion",
        projectNumber: null as string | null,
        customerName: "Mortenson",
        quoteRows: [
          {
            stagingId: "qs1",
            emailMessageId: "em-q1",
            subject: "North Memorial Expansion - Structural Steel Quote",
            bodyText: "Quote",
            senderName: "Mortenson",
            attachmentMetadata: [],
            receivedAt: new Date("2026-01-12"),
            displayName: null,
            extractedScope: "Beams, columns",
            extractedScopeDetail: null,
            extractedAmount: 182000,
            extractedNotes: null,
            userConfirmedMatch: false,
            userEditedFields: null,
            matchStatus: "UNMATCHED",
          },
        ],
      },
    ];

    prisma.bidFolderDiscoveryEmail.findMany = vi.fn(async () => [
      { emailMessageId: "em-invite" },
    ]);
    prisma.emailMessage.findMany = vi.fn(async () => [
      {
        id: "em-invite",
        subject: "ITB - North Memorial Expansion",
        bodyText: "Invitation to Bid. Bids due Jan 5.",
        snippet: null,
        senderName: "Mortenson",
        senderEmail: "gc@mortenson.com",
        threadId: "t1",
        attachmentMetadata: [],
        receivedAt: new Date("2025-12-18"),
      },
    ]);

    await reconstructCandidatesFromQuoteGroups({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
      groups,
    });

    expect(prisma.bidCandidate.create).toHaveBeenCalled();
    const created = prisma.bidCandidate.create.mock.calls[0]![0].data;
    expect(created.originalBidSource).toBe("BID_INVITES_FOLDER");
    expect(progress.originalBidFromInvites).toBe(1);
    expect(progress.candidatesCreated).toBe(1);

    const inviteLink = prisma.bidCandidateEmail.upsert.mock.calls.find(
      (c) => c[0].create.emailMessageId === "em-invite"
    );
    expect(inviteLink).toBeTruthy();
  });

  it("uses Inbox fallback when Bid Invites miss", async () => {
    const progress = emptyBidEmailAnalyzeProgress();
    const prisma = basePrisma();
    const groups = [
      {
        groupKey: "qname:falcon warehouse",
        projectName: "Falcon Warehouse",
        projectNumber: null as string | null,
        customerName: null as string | null,
        quoteRows: [
          {
            stagingId: "qs1",
            emailMessageId: "em-q1",
            subject: "Falcon Warehouse Quote",
            bodyText: "Quote",
            senderName: "ACME",
            attachmentMetadata: [],
            receivedAt: new Date("2026-02-01"),
            displayName: null,
            extractedScope: null,
            extractedScopeDetail: null,
            extractedAmount: 50000,
            extractedNotes: null,
            userConfirmedMatch: false,
            userEditedFields: null,
            matchStatus: "UNMATCHED",
          },
        ],
      },
    ];

    // First findMany: invite discovery (empty). Later: exclude discovery + inbox search.
    let discoveryCalls = 0;
    prisma.bidFolderDiscoveryEmail.findMany = vi.fn(async () => {
      discoveryCalls += 1;
      return [];
    });
    prisma.emailMessage.findMany = vi.fn(async (args: { where?: { OR?: unknown } }) => {
      // Inbox search has OR subject filters
      if (args?.where?.OR) {
        return [
          {
            id: "em-inbox",
            subject: "Invitation to Bid — Falcon Warehouse",
            bodyText: "Please bid Falcon Warehouse",
            snippet: null,
            senderName: "GC",
            senderEmail: "gc@example.com",
            threadId: "t-inbox",
            attachmentMetadata: [],
            receivedAt: new Date("2025-12-01"),
          },
        ];
      }
      return [];
    });

    await reconstructCandidatesFromQuoteGroups({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
      groups,
    });

    expect(discoveryCalls).toBeGreaterThanOrEqual(1);
    const created = prisma.bidCandidate.create.mock.calls[0]![0].data;
    expect(created.originalBidSource).toBe("INBOX_FALLBACK");
    expect(progress.originalBidFromInbox).toBe(1);
  });

  it("creates Quote-only Candidate when no Bid email found", async () => {
    const progress = emptyBidEmailAnalyzeProgress();
    const prisma = basePrisma();
    const groups = [
      {
        groupKey: "qname:orphan project",
        projectName: "Orphan Project",
        projectNumber: null as string | null,
        customerName: null as string | null,
        quoteRows: [
          {
            stagingId: "qs1",
            emailMessageId: "em-q1",
            subject: "Orphan Project Quote",
            bodyText: "Quote only",
            senderName: "X",
            attachmentMetadata: [],
            receivedAt: new Date("2026-03-01"),
            displayName: null,
            extractedScope: "Stairs",
            extractedScopeDetail: null,
            extractedAmount: 12000,
            extractedNotes: null,
            userConfirmedMatch: false,
            userEditedFields: null,
            matchStatus: "UNMATCHED",
          },
        ],
      },
    ];

    prisma.bidFolderDiscoveryEmail.findMany = vi.fn(async () => []);
    prisma.emailMessage.findMany = vi.fn(async () => []);

    await reconstructCandidatesFromQuoteGroups({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
      groups,
    });

    const created = prisma.bidCandidate.create.mock.calls[0]![0].data;
    expect(created.originalBidSource).toBe("NONE");
    expect(created.status).toBe("NEEDS_REVIEW");
    expect(progress.originalBidNotFound).toBe(1);
    expect(prisma.bidQuoteStaging.update).toHaveBeenCalled();
  });

  it("does not auto-match on weak similarity", async () => {
    const progress = emptyBidEmailAnalyzeProgress();
    const prisma = basePrisma();
    const groups = [
      {
        groupKey: "qname:alpha hospital",
        projectName: "Alpha Hospital",
        projectNumber: null as string | null,
        customerName: null as string | null,
        quoteRows: [
          {
            stagingId: "qs1",
            emailMessageId: "em-q1",
            subject: "Alpha Hospital Quote",
            bodyText: "Quote",
            senderName: null,
            attachmentMetadata: [],
            receivedAt: new Date("2026-01-15"),
            displayName: null,
            extractedScope: null,
            extractedScopeDetail: null,
            extractedAmount: null,
            extractedNotes: null,
            userConfirmedMatch: false,
            userEditedFields: null,
            matchStatus: "UNMATCHED",
          },
        ],
      },
    ];

    prisma.bidFolderDiscoveryEmail.findMany = vi.fn(async () => [
      { emailMessageId: "em-unrelated" },
    ]);
    prisma.emailMessage.findMany = vi.fn(async (args: { where?: { OR?: unknown } }) => {
      if (args?.where?.OR) return [];
      return [
        {
          id: "em-unrelated",
          subject: "Weekly newsletter",
          bodyText: "Hello",
          snippet: null,
          senderName: "News",
          senderEmail: "n@x.com",
          threadId: "t9",
          attachmentMetadata: [],
          receivedAt: new Date("2025-12-01"),
        },
      ];
    });

    await reconstructCandidatesFromQuoteGroups({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
      groups,
    });

    const created = prisma.bidCandidate.create.mock.calls[0]![0].data;
    expect(created.originalBidSource).toBe("NONE");
  });
});
