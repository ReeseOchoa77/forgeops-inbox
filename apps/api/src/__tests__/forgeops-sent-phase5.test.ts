/**
 * Phase 5: ForgeOps-sent classification + outbound persistence.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveClassificationAuthority,
  canReplaceClassificationAuthority,
  BUSINESS_SUBTYPE_LABELS,
} from "@forgeops/shared";

const here = import.meta.dirname;

function readSrc(rel: string) {
  return readFileSync(join(here, rel), "utf8");
}

describe("Phase 5 — ForgeOps-sent authority + persistence", () => {
  it("A/B) send persists businessTypeKey + USER_EXPLICIT path", () => {
    const send = readSrc("../interfaces/http/routes/send.route.ts");
    const persist = readSrc(
      "../application/services/outbound-attachments.ts"
    );
    expect(send).toContain("businessTypeKey");
    expect(persist).toContain("direction: \"SENT\"");
    expect(persist).toContain("composedInForgeOps: true");
    expect(persist).toContain("persistUserExplicitClassification");
  });

  it("explicit classification stamps USER_EXPLICIT", () => {
    const src = readSrc(
      "../application/services/persist-user-explicit-classification.ts"
    );
    expect(src).toContain("USER_EXPLICIT");
    expect(src).toContain("forgeops_compose");
    expect(src).toContain("reviewedByUserId");
  });

  it("I) GENERAL is explicit subtype distinct from null", () => {
    expect(BUSINESS_SUBTYPE_LABELS.GENERAL).toBe("General");
    const auth = resolveClassificationAuthority({
      routingHints: {
        authority: "USER_EXPLICIT",
        source: "forgeops_compose",
      },
    });
    expect(auth).toBe("USER_EXPLICIT");
    expect(
      canReplaceClassificationAuthority({
        existing: "USER_EXPLICIT",
        incoming: "AI",
      })
    ).toBe(false);
  });

  it("F) manual reclassify sets USER_EXPLICIT", () => {
    const src = readSrc(
      "../interfaces/http/routes/classification-engine.route.ts"
    );
    expect(src).toContain("USER_EXPLICIT");
    expect(src).toContain("manual_reclassify");
  });

  it("J/K) outbound persist sets SENT + composedInForgeOps", async () => {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      emailThread: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({
          id: "th1",
          gmailThreadId: "th-g",
        })),
        update: vi.fn(async () => ({})),
      },
      emailMessage: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "msg1" };
        }),
      },
      emailAttachment: { create: vi.fn() },
      classification: { upsert: vi.fn(async () => ({})) },
    };
    const { persistOutboundSentAttachments } = await import(
      "../application/services/outbound-attachments.js"
    );
    await persistOutboundSentAttachments({
      prisma: prisma as never,
      storage: { configured: false } as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      connectionEmail: "me@co.com",
      action: "new",
      to: ["gc@x.com"],
      cc: [],
      bcc: [],
      subject: "Quote for Falcon",
      body: "<p>hi</p>",
      bodyFormat: "html",
      providerMessageId: "sent",
      originalThreadId: null,
      originalGmailThreadId: null,
      attachments: [],
      businessTypeKey: "ESTIMATE_QUOTE",
      userId: "u1",
    });
    expect(created[0]!.direction).toBe("SENT");
    expect(created[0]!.composedInForgeOps).toBe(true);
    expect(created[0]!.classificationStatus).toBe("CLASSIFIED");
    expect(prisma.classification.upsert).toHaveBeenCalled();
  });

  it("Graph sendMail returns no message identity (documented)", () => {
    const src = readSrc("../interfaces/http/routes/send.route.ts");
    expect(src).toContain('return { providerMessageId: "sent" }');
    expect(src).toContain('return { providerMessageId: "replied" }');
  });

  it("W) historical BIDDING Job path untouched", () => {
    expect(readSrc("../interfaces/http/routes/bidding.route.ts")).toContain(
      "ACTIVE_BID_STATUS"
    );
  });
});
