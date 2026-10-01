import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  suggestNextJobNumberFromList,
  isJobMatcherAutoAssignEnabled,
  normalizeName,
} from "@forgeops/shared";

const extractMock = vi.fn();

vi.mock("@forgeops/ai", async () => {
  const actual = await vi.importActual<typeof import("@forgeops/ai")>(
    "@forgeops/ai"
  );
  return {
    ...actual,
    createOpenAIClient: vi.fn(() => ({})),
    OpenAIBiddingIntakeExtractor: class {
      extract = extractMock;
    },
  };
});

import { buildBiddingIntakeSuggestions } from "../application/services/bidding-intake-suggestions.js";

const here = dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(
  join(here, "../interfaces/http/routes/bidding.route.ts"),
  "utf8"
);
const dialogSrc = readFileSync(
  join(here, "../../../web/src/components/EmailJobAssignmentDialog.tsx"),
  "utf8"
);
const inboxSrc = readFileSync(
  join(here, "../../../web/src/views/MessagesView.tsx"),
  "utf8"
);

function basePrisma(overrides?: {
  subject?: string;
  body?: string;
  customers?: Array<{ id: string; name: string; normalizedName: string }>;
  jobNumbers?: string[];
}) {
  const subject =
    overrides?.subject ?? "Invitation to Bid - Garden City Elementary School";
  const body =
    overrides?.body ??
    "Mortenson invites you to submit a proposal. Bids due October 15, 2026.";
  return {
    emailMessage: {
      findFirst: vi.fn().mockResolvedValue({
        id: "msg-1",
        subject,
        bodyText: body,
        senderEmail: "notifications@buildingconnected.com",
        senderName: "BuildingConnected",
        normalizedEmail: {
          cleanTextBody: body,
          normalizedSubject: subject,
          subject,
        },
      }),
    },
    job: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          (overrides?.jobNumbers ?? ["26-200", "26-184"]).map((jobNumber) => ({
            jobNumber,
          }))
        ),
      create: vi.fn(),
    },
    customer: {
      findMany: vi.fn().mockResolvedValue(overrides?.customers ?? []),
      create: vi.fn(),
    },
    entityAlias: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("bidding intake suggestions service", () => {
  beforeEach(() => {
    extractMock.mockReset();
  });

  it("returns deterministic name + job number + empty customer without AI", async () => {
    const prisma = basePrisma({ customers: [] });

    const result = await buildBiddingIntakeSuggestions({
      prisma: prisma as never,
      workspaceId: "ws",
      messageId: "msg-1",
      openaiApiKey: null,
    });

    expect(result).toEqual({
      projectName: "Garden City Elementary School",
      projectNameSource: "subject_cleanup",
      jobNumber: "26-201",
      bidDueAt: "2026-10-15",
      bidDueSource: "deterministic",
      customer: {
        status: "NONE",
        customerId: null,
        customerName: null,
        candidates: [],
      },
    });
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("AI failure / missing key leaves customer blank", async () => {
    const prisma = basePrisma({
      subject: "Interesting steel package",
      body: "See attached drawings.",
      jobNumbers: ["2148"],
    });

    const result = await buildBiddingIntakeSuggestions({
      prisma: prisma as never,
      workspaceId: "ws",
      messageId: "msg-1",
      openaiApiKey: null,
    });

    expect(result?.projectName).toBe("Interesting steel package");
    expect(result?.jobNumber).toBe("2149");
    expect(result?.bidDueAt).toBeNull();
    expect(result?.customer.status).toBe("NONE");
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("suggestion list helper does not mutate inputs", () => {
    const nums = ["2148"];
    expect(suggestNextJobNumberFromList(nums)).toBe("2149");
    expect(nums).toEqual(["2148"]);
  });

  it("AI company resolves to existing Customer; never creates Customer", async () => {
    extractMock.mockResolvedValue({
      projectName: null,
      bidDueDate: null,
      customerCompanyName: "Mortenson",
    });
    const prisma = basePrisma({
      customers: [
        {
          id: "c-mortenson",
          name: "Mortenson",
          normalizedName: normalizeName("Mortenson"),
        },
      ],
    });

    const result = await buildBiddingIntakeSuggestions({
      prisma: prisma as never,
      workspaceId: "ws",
      messageId: "msg-1",
      openaiApiKey: "sk-test",
    });

    expect(result?.projectName).toBe("Garden City Elementary School");
    expect(result?.bidDueAt).toBe("2026-10-15");
    expect(result?.customer).toEqual({
      status: "EXISTING",
      customerId: "c-mortenson",
      customerName: "Mortenson",
      candidates: [{ id: "c-mortenson", name: "Mortenson", score: 1 }],
    });
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("AI new company proposes NEW without persisting", async () => {
    extractMock.mockResolvedValue({
      projectName: "Project Alpha",
      bidDueDate: "2026-11-02",
      customerCompanyName: "Northland Construction",
    });
    const prisma = basePrisma({
      subject: "ITB - Project Alpha",
      body: "Northland Construction invites you to bid. Proposals due November 2, 2026.",
      customers: [],
    });

    const result = await buildBiddingIntakeSuggestions({
      prisma: prisma as never,
      workspaceId: "ws",
      messageId: "msg-1",
      openaiApiKey: "sk-test",
    });

    expect(result?.customer.status).toBe("NEW");
    expect(result?.customer.customerName).toBe("Northland Construction");
    expect(result?.customer.customerId).toBeNull();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("rejects project-name / person / platform as Customer", async () => {
    extractMock.mockResolvedValue({
      projectName: null,
      bidDueDate: null,
      customerCompanyName: "Garden City Elementary School",
    });
    const prisma = basePrisma({ customers: [] });
    const result = await buildBiddingIntakeSuggestions({
      prisma: prisma as never,
      workspaceId: "ws",
      messageId: "msg-1",
      openaiApiKey: "sk-test",
    });
    expect(result?.customer.status).toBe("NONE");
  });
});

describe("bidding intake route / freeze / customer regression", () => {
  it("registers intake-suggestions GET and resolveOrCreate on from-email", () => {
    expect(routeSrc).toContain("/bidding/intake-suggestions");
    expect(routeSrc).toContain("buildBiddingIntakeSuggestions");
    expect(routeSrc).toContain("resolveOrCreateBiddingCustomer");
    expect(routeSrc).toContain("customerName");
    expect(routeSrc).toContain("JOB_NUMBER_TAKEN");
  });

  it("does not weaken Job matcher freeze", () => {
    delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    expect(isJobMatcherAutoAssignEnabled()).toBe(false);
    expect(routeSrc).toContain("USER_BID_ASSIGNMENT");
  });

  it("UI protects dirty customer field and supports new-customer proposal", () => {
    expect(dialogSrc).toContain("nameDirty");
    expect(dialogSrc).toContain("jobNumberDirty");
    expect(dialogSrc).toContain("bidDueDirty");
    expect(dialogSrc).toContain("customerDirty");
    expect(dialogSrc).toContain("getBiddingIntakeSuggestions");
    expect(dialogSrc).toContain("New customer");
    expect(dialogSrc).toContain("proposedCustomerName");
    expect(dialogSrc).toContain("customerName: createCustomerName");
    expect(dialogSrc).toContain("Create Job");
    expect(dialogSrc).toContain("+ Create new job");
  });

  it("Inbox unifies Job assignment; removes row-level Add to Bidding", () => {
    expect(inboxSrc).toContain("EmailJobAssignmentDialog");
    expect(inboxSrc).toContain("Assign email to Job");
    expect(inboxSrc).toContain("Change Job assignment");
    expect(inboxSrc).not.toMatch(/>\s*Add to Bidding\s*</);
    expect(inboxSrc).toContain("TypeBadge");
    expect(inboxSrc).toContain("Unassigned");
  });

  it("Inbox uses compact MailboxCategoryDot instead of Biz/Pers pills", () => {
    expect(inboxSrc).toContain("MailboxCategoryDot");
    expect(inboxSrc).toContain("INBOX_ACTIONS_COLUMN_WIDTH_PX");
    expect(inboxSrc).not.toMatch(/>\s*Biz\s*</);
    expect(inboxSrc).not.toMatch(/>\s*Pers\s*</);
    expect(inboxSrc).toContain("handleReclassify");
  });

  it("suggestions path never creates Customer", () => {
    expect(routeSrc).toMatch(/intake-suggestions[\s\S]*?buildBiddingIntakeSuggestions/);
    expect(routeSrc).not.toMatch(
      /intake-suggestions[\s\S]*?customer\.create/
    );
  });
});
