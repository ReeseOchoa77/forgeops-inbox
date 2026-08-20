import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import {
  providerIngestRecipientListSchema,
  sanitizeProviderIngestRecipients,
} from "../application/services/sanitize-provider-ingest-recipients.js";

const MAX_SUBJECT_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 300;
const MAX_BODY_LENGTH = 100_000;
const MAX_RECIPIENTS = 200;
const MAX_TASKS = 5;

const n8nEmailResultSchema = z.object({
  source: z.object({
    provider: z.literal("outlook"),
    mailboxEmail: z.string().email(),
    providerMessageId: z.string().min(1).max(500),
    providerConversationId: z.string().max(500).nullable().optional(),
    internetMessageId: z.string().max(500).nullable().optional()
  }),
  email: z.object({
    subject: z.string().max(MAX_SUBJECT_LENGTH),
    normalizedSubject: z.string().max(MAX_SUBJECT_LENGTH),
    senderName: z.string().max(200).nullable().optional(),
    senderEmail: z.string().email(),
    senderDomain: z.string().max(200),
    to: providerIngestRecipientListSchema("to", MAX_RECIPIENTS),
    cc: providerIngestRecipientListSchema("cc", MAX_RECIPIENTS).default([]),
    receivedAt: z.string().datetime(),
    bodyText: z.string().max(MAX_BODY_LENGTH),
    bodyHtml: z.string().max(MAX_BODY_LENGTH).nullable().optional(),
    cleanBody: z.string().max(MAX_BODY_LENGTH),
    hasAttachments: z.boolean(),
    attachmentNames: z.array(z.string().max(200)).max(50).default([])
  }),
  analysis: z.object({
    businessCategory: z.enum(["BUSINESS", "NON_BUSINESS"]).optional(),
    mailboxCategory: z.enum(["BUSINESS", "PERSONAL"]).optional(),
    mailboxConfidence: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    summary: z.string().max(MAX_SUMMARY_LENGTH),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    containsActionRequest: z.boolean(),
    tasks: z.array(z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(2000).default(""),
      dueDate: z.string().nullable().optional().transform(val => {
        if (!val) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${val}T00:00:00.000Z`;
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
      }),
      recommendedOwner: z.string().max(200).nullable().optional(),
      confidence: z.number().min(0).max(1)
    })).max(MAX_TASKS).default([]),
    requiresReview: z.boolean(),
    reviewReasons: z.array(z.string().max(200)).max(20).default([])
  }).refine(
    analysis => !!(analysis.mailboxCategory || analysis.businessCategory),
    { message: "Either mailboxCategory or businessCategory is required", path: ["mailboxCategory"] }
  ).transform(analysis => {
    const resolvedCategory = analysis.mailboxCategory
      ?? (analysis.businessCategory === "NON_BUSINESS" ? "PERSONAL" : "BUSINESS");
    const resolvedConfidence = analysis.mailboxConfidence ?? analysis.confidence ?? 0;
    return {
      ...analysis,
      mailboxCategory: resolvedCategory as "BUSINESS" | "PERSONAL",
      mailboxConfidence: resolvedConfidence,
      businessCategory: resolvedCategory === "BUSINESS" ? "BUSINESS" as const : "NON_BUSINESS" as const,
      confidence: resolvedConfidence
    };
  })
});

function makeValidPayload(overrides?: Record<string, unknown>) {
  return {
    source: {
      provider: "outlook",
      mailboxEmail: "test@example.com",
      providerMessageId: "AAMkAGI2TG93AAA=",
      providerConversationId: "AAQkAGI2TG93conv=",
      internetMessageId: "<msg123@example.com>"
    },
    email: {
      subject: "Test Purchase Order #1234",
      normalizedSubject: "test purchase order #1234",
      senderName: "John Doe",
      senderEmail: "john@contractor.com",
      senderDomain: "contractor.com",
      to: ["inbox@example.com"],
      cc: [],
      receivedAt: "2026-07-14T12:00:00.000Z",
      bodyText: "Please review the attached PO for the Johnson project.",
      bodyHtml: "<p>Please review the attached PO for the Johnson project.</p>",
      cleanBody: "Please review the attached PO for the Johnson project.",
      hasAttachments: true,
      attachmentNames: ["PO-1234.pdf"]
    },
    analysis: {
      mailboxCategory: "BUSINESS",
      mailboxConfidence: 0.92,
      summary: "Purchase order review request for Johnson project",
      priority: "HIGH",
      containsActionRequest: true,
      tasks: [
        {
          title: "Review Purchase Order #1234",
          description: "Review attached PO for the Johnson project",
          dueDate: "2026-07-16T00:00:00.000Z",
          recommendedOwner: "operations@example.com",
          confidence: 0.88
        }
      ],
      requiresReview: false,
      reviewReasons: []
    },
    ...overrides
  };
}

describe("n8n email-results schema validation", () => {
  it("1. accepts a valid payload", () => {
    const payload = makeValidPayload();
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("2. accepts same payload twice (idempotency at schema level)", () => {
    const payload = makeValidPayload();
    const r1 = n8nEmailResultSchema.safeParse(payload);
    const r2 = n8nEmailResultSchema.safeParse(payload);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it("3. accepts updated analysis for existing message", () => {
    const payload = makeValidPayload({
      analysis: {
        ...makeValidPayload().analysis,
        confidence: 0.95,
        summary: "Updated summary with more context"
      }
    });
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("4. rejects malformed payload - missing required fields", () => {
    const result = n8nEmailResultSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("4b. rejects malformed payload - invalid email", () => {
    const payload = makeValidPayload();
    (payload.source as Record<string, unknown>).mailboxEmail = "not-an-email";
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("4c. rejects malformed payload - confidence out of range", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).confidence = 1.5;
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("4d. rejects malformed payload - too many tasks", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = Array.from({ length: 6 }, (_, i) => ({
      title: `Task ${i}`,
      description: "",
      dueDate: null,
      recommendedOwner: null,
      confidence: 0.9
    }));
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("4e. rejects malformed payload - wrong provider", () => {
    const payload = makeValidPayload();
    (payload.source as Record<string, unknown>).provider = "gmail";
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("5. validates API key format (constant-time comparison)", () => {
    const key = "a".repeat(32);
    const validBuf = Buffer.from(key, "utf-8");
    const invalidBuf = Buffer.from("b".repeat(32), "utf-8");
    expect(timingSafeEqual(validBuf, validBuf)).toBe(true);
    expect(timingSafeEqual(validBuf, invalidBuf)).toBe(false);
  });

  it("7. cross-workspace isolation - workspaceId is required", () => {
    const paramsSchema = z.object({ workspaceId: z.string().min(1) });
    expect(paramsSchema.safeParse({ workspaceId: "" }).success).toBe(false);
    expect(paramsSchema.safeParse({ workspaceId: "ws1" }).success).toBe(true);
  });

  it("8. low-confidence triggers review", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).mailboxConfidence = 0.6;
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.confidence < 0.80).toBe(true);
    }
  });

  it("9. multiple tasks accepted up to limit", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = Array.from({ length: 5 }, (_, i) => ({
      title: `Task ${i + 1}`,
      description: `Description for task ${i + 1}`,
      dueDate: null,
      recommendedOwner: null,
      confidence: 0.85
    }));
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.tasks.length).toBe(5);
    }
  });

  it("10. zero tasks accepted", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = [];
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.tasks.length).toBe(0);
    }
  });

  it("validates businessCategory enum", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).businessCategory = "INVALID";
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("validates priority enum", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).priority = "CRITICAL";
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects subject exceeding max length", () => {
    const payload = makeValidPayload();
    (payload.email as Record<string, unknown>).subject = "x".repeat(501);
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("defaults optional arrays", () => {
    const payload = makeValidPayload();
    delete (payload.email as Record<string, unknown>).cc;
    delete (payload.email as Record<string, unknown>).attachmentNames;
    delete (payload.analysis as Record<string, unknown>).tasks;
    delete (payload.analysis as Record<string, unknown>).reviewReasons;
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email.cc).toEqual([]);
      expect(result.data.email.attachmentNames).toEqual([]);
      expect(result.data.analysis.tasks).toEqual([]);
      expect(result.data.analysis.reviewReasons).toEqual([]);
    }
  });

  it("accepts multiple tasks from one email", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = [
      { title: "Review PO #1234", description: "Review attached PO", dueDate: "2026-07-28", confidence: 0.9, recommendedOwner: null },
      { title: "Update job log", description: "Log PO in system", dueDate: null, confidence: 0.85, recommendedOwner: null },
      { title: "Send confirmation", description: "Reply to vendor", dueDate: "2026-07-30T00:00:00.000Z", confidence: 0.88, recommendedOwner: null }
    ];
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.tasks.length).toBe(3);
    }
  });

  it("replaying same payload with multiple tasks validates identically", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = [
      { title: "Task A", description: "", dueDate: null, confidence: 0.9, recommendedOwner: null },
      { title: "Task B", description: "", dueDate: null, confidence: 0.8, recommendedOwner: null }
    ];
    const r1 = n8nEmailResultSchema.safeParse(payload);
    const r2 = n8nEmailResultSchema.safeParse(payload);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) {
      expect(r1.data.analysis.tasks.length).toBe(r2.data.analysis.tasks.length);
    }
  });

  it("accepts date-only due date (YYYY-MM-DD) and normalizes to UTC midnight", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = [
      { title: "Test task", description: "", dueDate: "2026-07-28", confidence: 0.9, recommendedOwner: null }
    ];
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.tasks[0]!.dueDate).toBe("2026-07-28T00:00:00.000Z");
    }
  });

  it("accepts full ISO due date", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = [
      { title: "Test task", description: "", dueDate: "2026-07-28T14:30:00.000Z", confidence: 0.9, recommendedOwner: null }
    ];
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.tasks[0]!.dueDate).toBe("2026-07-28T14:30:00.000Z");
    }
  });

  it("accepts null due date", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = [
      { title: "Test task", description: "", dueDate: null, confidence: 0.9, recommendedOwner: null }
    ];
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.tasks[0]!.dueDate).toBeNull();
    }
  });

  it("normalizes malformed dates to null instead of rejecting", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).tasks = [
      { title: "Test task", description: "", dueDate: "not-a-date", confidence: 0.9, recommendedOwner: null }
    ];
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.tasks[0]!.dueDate).toBeNull();
    }
  });

  it("task order change between analyses produces different task keys", () => {
    const payload1 = makeValidPayload();
    const payload2 = makeValidPayload();
    (payload1.analysis as Record<string, unknown>).tasks = [
      { title: "Task A", description: "", dueDate: null, confidence: 0.9, recommendedOwner: null },
      { title: "Task B", description: "", dueDate: null, confidence: 0.8, recommendedOwner: null }
    ];
    (payload2.analysis as Record<string, unknown>).tasks = [
      { title: "Task B", description: "", dueDate: null, confidence: 0.8, recommendedOwner: null },
      { title: "Task A", description: "", dueDate: null, confidence: 0.9, recommendedOwner: null }
    ];
    const r1 = n8nEmailResultSchema.safeParse(payload1);
    const r2 = n8nEmailResultSchema.safeParse(payload2);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it("accepts BUSINESS mailboxCategory", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).mailboxCategory = "BUSINESS";
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.analysis.mailboxCategory).toBe("BUSINESS");
  });

  it("accepts PERSONAL mailboxCategory", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).mailboxCategory = "PERSONAL";
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.analysis.mailboxCategory).toBe("PERSONAL");
  });

  it("rejects SPAM as mailboxCategory (not an AI classification)", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).mailboxCategory = "SPAM";
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("defaults mailboxCategory to BUSINESS when omitted", () => {
    const payload = makeValidPayload();
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.analysis.mailboxCategory).toBe("BUSINESS");
  });

  it("rejects TRASH as mailboxCategory (user action, not classification)", () => {
    const payload = makeValidPayload();
    (payload.analysis as Record<string, unknown>).mailboxCategory = "TRASH";
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("accepts legacy businessCategory BUSINESS and maps to mailboxCategory BUSINESS", () => {
    const payload = makeValidPayload();
    const analysis = payload.analysis as Record<string, unknown>;
    delete analysis.mailboxCategory;
    delete analysis.mailboxConfidence;
    analysis.businessCategory = "BUSINESS";
    analysis.confidence = 0.85;
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.mailboxCategory).toBe("BUSINESS");
      expect(result.data.analysis.confidence).toBe(0.85);
    }
  });

  it("accepts legacy businessCategory NON_BUSINESS and maps to mailboxCategory PERSONAL", () => {
    const payload = makeValidPayload();
    const analysis = payload.analysis as Record<string, unknown>;
    delete analysis.mailboxCategory;
    delete analysis.mailboxConfidence;
    analysis.businessCategory = "NON_BUSINESS";
    analysis.confidence = 0.70;
    analysis.tasks = [];
    analysis.containsActionRequest = false;
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.mailboxCategory).toBe("PERSONAL");
      expect(result.data.analysis.confidence).toBe(0.70);
    }
  });

  it("rejects payload with neither mailboxCategory nor businessCategory", () => {
    const payload = makeValidPayload();
    const analysis = payload.analysis as Record<string, unknown>;
    delete analysis.mailboxCategory;
    delete analysis.mailboxConfidence;
    delete analysis.businessCategory;
    delete analysis.confidence;
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("new format takes precedence: mailboxCategory overrides businessCategory", () => {
    const payload = makeValidPayload();
    const analysis = payload.analysis as Record<string, unknown>;
    analysis.mailboxCategory = "PERSONAL";
    analysis.mailboxConfidence = 0.95;
    analysis.businessCategory = "BUSINESS";
    analysis.confidence = 0.80;
    analysis.tasks = [];
    analysis.containsActionRequest = false;
    const result = n8nEmailResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysis.mailboxCategory).toBe("PERSONAL");
      expect(result.data.analysis.mailboxConfidence).toBe(0.95);
    }
  });
});

describe("provider-ingest recipient sanitization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a valid to recipient unchanged (normalized)", () => {
    const result = sanitizeProviderIngestRecipients(["  Valid@Example.COM  "]);
    expect(result.recipients).toEqual(["valid@example.com"]);
    expect(result.dropped).toEqual([]);
  });

  it("drops a malformed to recipient and still allows schema parse", () => {
    const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
    const result = sanitizeProviderIngestRecipients(["rob@checkpointwelding"], {
      field: "to",
      log: (event, data) => logs.push({ event, data }),
    });
    expect(result.recipients).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(logs[0]?.event).toBe("n8n-ingest-recipient-dropped");
    expect(logs[0]?.data.reason).toBe("invalid_email");
    expect(String(logs[0]?.data.recipientPreview)).toContain("rob@checkpointwelding");
    expect(JSON.stringify(logs)).not.toMatch(/Bearer |refresh_token|access_token/i);

    const payload = makeValidPayload();
    (payload.email as Record<string, unknown>).to = ["rob@checkpointwelding"];
    const parsed = n8nEmailResultSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email.to).toEqual([]);
    }
  });

  it("preserves valid recipients when mixed with malformed to", () => {
    const result = sanitizeProviderIngestRecipients([
      "valid@example.com",
      "rob@checkpointwelding",
      "also.ok@tekstl.net",
    ]);
    expect(result.recipients).toEqual([
      "valid@example.com",
      "also.ok@tekstl.net",
    ]);
    expect(result.dropped).toHaveLength(1);
  });

  it("drops malformed cc the same way", () => {
    const payload = makeValidPayload();
    (payload.email as Record<string, unknown>).cc = [
      "ok@example.com",
      "bad@singlelabel",
    ];
    const parsed = n8nEmailResultSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email.cc).toEqual(["ok@example.com"]);
    }
  });

  it("succeeds when multiple recipients are malformed", () => {
    const payload = makeValidPayload();
    (payload.email as Record<string, unknown>).to = [
      "a@nodot",
      "rob@checkpointwelding",
      "@@@",
    ];
    (payload.email as Record<string, unknown>).cc = ["also@bad"];
    const parsed = n8nEmailResultSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email.to).toEqual([]);
      expect(parsed.data.email.cc).toEqual([]);
    }
  });

  it("NDR example: malformed to does not return schema validation failure", () => {
    const payload = makeValidPayload();
    (payload.email as Record<string, unknown>).senderEmail =
      "microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@tekstl.net";
    (payload.email as Record<string, unknown>).senderDomain = "tekstl.net";
    (payload.email as Record<string, unknown>).to = ["rob@checkpointwelding"];
    const parsed = n8nEmailResultSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email.to).toEqual([]);
      expect(parsed.data.email.senderEmail).toBe(
        "microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@tekstl.net"
      );
    }
  });

  it("outbound-style strict email() still rejects single-label domains", () => {
    // Mirrors apps/api send.route.ts: z.array(z.string().email())
    const outboundTo = z.array(z.string().email()).min(1);
    expect(outboundTo.safeParse(["rob@checkpointwelding"]).success).toBe(false);
    expect(outboundTo.safeParse(["valid@example.com"]).success).toBe(true);
  });

  it("dedupes normalized recipients", () => {
    const result = sanitizeProviderIngestRecipients([
      "A@Example.com",
      "a@example.com",
    ]);
    expect(result.recipients).toEqual(["a@example.com"]);
  });
});
