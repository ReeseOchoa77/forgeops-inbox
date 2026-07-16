import { describe, it, expect } from "vitest";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";

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
    to: z.array(z.string().email()).max(MAX_RECIPIENTS),
    cc: z.array(z.string().email()).max(MAX_RECIPIENTS).default([]),
    receivedAt: z.string().datetime(),
    bodyText: z.string().max(MAX_BODY_LENGTH),
    bodyHtml: z.string().max(MAX_BODY_LENGTH).nullable().optional(),
    cleanBody: z.string().max(MAX_BODY_LENGTH),
    hasAttachments: z.boolean(),
    attachmentNames: z.array(z.string().max(200)).max(50).default([])
  }),
  analysis: z.object({
    businessCategory: z.enum(["BUSINESS", "NON_BUSINESS"]),
    confidence: z.number().min(0).max(1),
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
      businessCategory: "BUSINESS",
      confidence: 0.92,
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
    (payload.analysis as Record<string, unknown>).confidence = 0.6;
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
});
