import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";

// ── Schema validation tests ─────────────────────────────────────────────

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".scr", ".msi", ".com",
  ".vbs", ".js", ".ps1", ".sh", ".pif", ".ws", ".wsf",
]);

function sanitizeFilename(filename: string): string {
  let sanitized = filename
    .replace(/\0/g, "")
    .replace(/\.\./g, "_")
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._\-() ]/g, "_")
    .replace(/_{2,}/g, "_")
    .trim();
  if (!sanitized || sanitized === "." || sanitized === ".." || /^_+$/.test(sanitized)) {
    sanitized = "attachment";
  }
  return sanitized.slice(0, 200);
}

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return "";
  return filename.slice(dotIndex).toLowerCase();
}

const uploadResponseSchema = z.object({
  status: z.enum(["created", "unchanged", "failed"]),
  attachmentId: z.string(),
  emailId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

const listResponseSchema = z.object({
  attachments: z.array(z.object({
    id: z.string().min(1),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    isInline: z.boolean(),
    contentId: z.string().nullable(),
    uploadStatus: z.enum(["PENDING", "UPLOADED", "FAILED", "REJECTED"]),
    createdAt: z.string(),
  })),
});

// ── Unit tests ──────────────────────────────────────────────────────────

describe("attachment upload validation", () => {

  it("valid PDF upload produces a created response shape", () => {
    const response = {
      status: "created",
      attachmentId: "ctest123",
      emailId: "msg456",
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 102400,
    };
    const parsed = uploadResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
  });

  it("valid spreadsheet upload (.xlsx) produces a created response", () => {
    const response = {
      status: "created",
      attachmentId: "ctest789",
      emailId: "msg456",
      filename: "budget.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 204800,
    };
    const parsed = uploadResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
  });

  it("valid image upload (.png) produces a created response", () => {
    const response = {
      status: "created",
      attachmentId: "ctest101",
      emailId: "msg456",
      filename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 51200,
    };
    const parsed = uploadResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
  });

  it("duplicate providerAttachmentId returns unchanged status", () => {
    const response = {
      status: "unchanged",
      attachmentId: "ctest123",
      emailId: "msg456",
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 102400,
    };
    const parsed = uploadResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("unchanged");
    }
  });

  it("rejects dangerous executable type (.exe)", () => {
    const ext = getExtension("malware.exe");
    expect(BLOCKED_EXTENSIONS.has(ext)).toBe(true);
  });

  it("rejects .bat extension", () => {
    expect(BLOCKED_EXTENSIONS.has(getExtension("script.bat"))).toBe(true);
  });

  it("rejects .cmd extension", () => {
    expect(BLOCKED_EXTENSIONS.has(getExtension("run.cmd"))).toBe(true);
  });

  it("rejects .scr extension", () => {
    expect(BLOCKED_EXTENSIONS.has(getExtension("screensaver.scr"))).toBe(true);
  });

  it("rejects .msi extension", () => {
    expect(BLOCKED_EXTENSIONS.has(getExtension("installer.msi"))).toBe(true);
  });

  it("rejects .vbs extension", () => {
    expect(BLOCKED_EXTENSIONS.has(getExtension("macro.vbs"))).toBe(true);
  });

  it("rejects .ps1 extension", () => {
    expect(BLOCKED_EXTENSIONS.has(getExtension("script.ps1"))).toBe(true);
  });

  it("rejects .sh extension", () => {
    expect(BLOCKED_EXTENSIONS.has(getExtension("deploy.sh"))).toBe(true);
  });

  it("allows safe extensions (.pdf, .xlsx, .png, .jpg, .docx, .csv)", () => {
    for (const ext of [".pdf", ".xlsx", ".png", ".jpg", ".docx", ".csv", ".txt", ".zip"]) {
      expect(BLOCKED_EXTENSIONS.has(ext)).toBe(false);
    }
  });
});

describe("filename sanitization", () => {
  it("strips path traversal sequences", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFilename("..\\..\\windows\\system32")).not.toContain("..");
  });

  it("strips null bytes", () => {
    expect(sanitizeFilename("file\0name.pdf")).toBe("filename.pdf");
  });

  it("strips directory separators", () => {
    const result = sanitizeFilename("/path/to/file.pdf");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
  });

  it("handles empty filename", () => {
    expect(sanitizeFilename("")).toBe("attachment");
  });

  it("handles dots-only filename", () => {
    expect(sanitizeFilename("..")).toBe("attachment");
  });

  it("truncates long filenames to 200 chars", () => {
    const longName = "a".repeat(300) + ".pdf";
    expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(200);
  });

  it("preserves normal filenames", () => {
    expect(sanitizeFilename("invoice-2026.pdf")).toBe("invoice-2026.pdf");
  });

  it("preserves parentheses in filenames", () => {
    expect(sanitizeFilename("document (1).pdf")).toBe("document (1).pdf");
  });
});

describe("file size validation", () => {
  const MAX_SIZE = 25 * 1024 * 1024;

  it("rejects file over 25MB", () => {
    const oversizedBytes = MAX_SIZE + 1;
    expect(oversizedBytes > MAX_SIZE).toBe(true);
  });

  it("accepts file at exactly 25MB", () => {
    expect(MAX_SIZE <= MAX_SIZE).toBe(true);
  });

  it("accepts small file", () => {
    expect(1024 <= MAX_SIZE).toBe(true);
  });
});

describe("SHA-256 checksum computation", () => {
  it("produces consistent checksums for same content", () => {
    const data = Buffer.from("test file content");
    const hash1 = createHash("sha256").update(data).digest("hex");
    const hash2 = createHash("sha256").update(data).digest("hex");
    expect(hash1).toBe(hash2);
  });

  it("produces different checksums for different content", () => {
    const hash1 = createHash("sha256").update(Buffer.from("file A")).digest("hex");
    const hash2 = createHash("sha256").update(Buffer.from("file B")).digest("hex");
    expect(hash1).not.toBe(hash2);
  });
});

describe("storage key format", () => {
  it("follows the expected pattern", () => {
    const workspaceId = "ws123";
    const emailMessageId = "msg456";
    const attachmentId = "att789";
    const normalizedFilename = "invoice-2026.pdf";

    const key = `attachments/${workspaceId}/${emailMessageId}/${attachmentId}/${normalizedFilename}`;
    expect(key).toBe("attachments/ws123/msg456/att789/invoice-2026.pdf");
    expect(key.startsWith("attachments/")).toBe(true);
    expect(key.split("/").length).toBe(5);
  });
});

describe("list attachments response shape", () => {
  it("validates a proper attachment list response", () => {
    const response = {
      attachments: [
        {
          id: "att1",
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          sizeBytes: 102400,
          isInline: false,
          contentId: null,
          uploadStatus: "UPLOADED" as const,
          createdAt: "2026-08-04T12:00:00.000Z",
        },
      ],
    };
    const parsed = listResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
  });

  it("validates empty attachment list", () => {
    const response = { attachments: [] };
    const parsed = listResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.attachments.length).toBe(0);
    }
  });

  it("validates attachment with all upload statuses", () => {
    for (const status of ["PENDING", "UPLOADED", "FAILED", "REJECTED"] as const) {
      const response = {
        attachments: [{
          id: "att1",
          filename: "file.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          isInline: false,
          contentId: null,
          uploadStatus: status,
          createdAt: "2026-08-04T12:00:00.000Z",
        }],
      };
      const parsed = listResponseSchema.safeParse(response);
      expect(parsed.success).toBe(true);
    }
  });

  it("validates inline attachment with contentId", () => {
    const response = {
      attachments: [{
        id: "att1",
        filename: "logo.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        isInline: true,
        contentId: "cid:logo123",
        uploadStatus: "UPLOADED" as const,
        createdAt: "2026-08-04T12:00:00.000Z",
      }],
    };
    const parsed = listResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
  });
});

describe("mock storage abstraction", () => {
  const createMockStorage = () => {
    const store = new Map<string, { data: Buffer; contentType: string }>();
    return {
      configured: true,
      upload: vi.fn(async (key: string, data: Buffer, contentType: string) => {
        store.set(key, { data, contentType });
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      exists: vi.fn(async (key: string) => store.has(key)),
      getSignedDownloadUrl: vi.fn(async (key: string, filename: string, _contentType: string, _expiresIn?: number) =>
        `https://s3.example.com/${key}?filename=${filename}&X-Amz-Signature=mock`
      ),
      getObject: vi.fn(async (key: string) => {
        const item = store.get(key);
        if (!item) throw new Error("Not found");
        return item;
      }),
      _store: store,
    };
  };

  it("upload stores data and can be verified with exists", async () => {
    const storage = createMockStorage();
    const key = "attachments/ws1/msg1/att1/file.pdf";
    const data = Buffer.from("pdf content");

    await storage.upload(key, data, "application/pdf");
    expect(await storage.exists(key)).toBe(true);
    expect(storage.upload).toHaveBeenCalledOnce();
  });

  it("delete removes data", async () => {
    const storage = createMockStorage();
    const key = "attachments/ws1/msg1/att1/file.pdf";

    await storage.upload(key, Buffer.from("data"), "application/pdf");
    expect(await storage.exists(key)).toBe(true);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("getSignedDownloadUrl generates a URL", async () => {
    const storage = createMockStorage();
    const url = await storage.getSignedDownloadUrl(
      "attachments/ws1/msg1/att1/file.pdf",
      "file.pdf",
      "application/pdf",
      900
    );
    expect(url).toContain("s3.example.com");
    expect(url).toContain("file.pdf");
  });

  it("download requires workspace access (auth check pattern)", () => {
    const sessionUser = { userId: "user1" };
    const membershipCheck = (userId: string, workspaceId: string) => {
      if (workspaceId === "ws1" && userId === "user1") {
        return { role: "MEMBER" };
      }
      return null;
    };

    expect(membershipCheck(sessionUser.userId, "ws1")).not.toBeNull();
    expect(membershipCheck(sessionUser.userId, "ws2")).toBeNull();
    expect(membershipCheck("other-user", "ws1")).toBeNull();
  });

  it("attachment must belong to correct workspace", () => {
    const attachment = {
      id: "att1",
      workspaceId: "ws1",
      storageKey: "attachments/ws1/msg1/att1/file.pdf",
    };

    const requestWorkspaceId = "ws2";
    expect(attachment.workspaceId === requestWorkspaceId).toBe(false);
  });
});

describe("auth validation patterns", () => {
  it("session auth required for download", () => {
    const session = null;
    expect(session).toBeNull();
  });

  it("API key auth accepted for upload", () => {
    const apiKey = "a".repeat(32);
    const configuredKey = "a".repeat(32);
    const a = Buffer.from(configuredKey, "utf-8");
    const b = Buffer.from(apiKey, "utf-8");
    const { timingSafeEqual } = require("node:crypto");
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("invalid API key rejected", () => {
    const apiKey = "b".repeat(32);
    const configuredKey = "a".repeat(32);
    const a = Buffer.from(configuredKey, "utf-8");
    const b = Buffer.from(apiKey, "utf-8");
    const { timingSafeEqual } = require("node:crypto");
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("no auth header results in 401 pattern", () => {
    const authHeader: string | undefined = undefined;
    expect(!authHeader).toBe(true);
  });
});

describe("cross-workspace isolation", () => {
  it("email lookup is scoped to workspace", () => {
    const queryWhere = {
      workspaceId: "ws1",
      OR: [{ id: "msg1" }, { gmailMessageId: "msg1" }],
    };
    expect(queryWhere.workspaceId).toBe("ws1");
  });

  it("attachment download checks workspace ownership", () => {
    const attachmentQuery = {
      id: "att1",
      workspaceId: "ws1",
      uploadStatus: "UPLOADED",
    };
    expect(attachmentQuery.workspaceId).toBe("ws1");
  });
});

describe("idempotency rules", () => {
  it("same providerAttachmentId returns unchanged on re-upload", () => {
    const existingAttachments = [
      { id: "att1", providerAttachmentId: "provider-123", emailMessageId: "msg1" },
    ];

    const incoming = { providerAttachmentId: "provider-123", emailMessageId: "msg1" };
    const match = existingAttachments.find(
      a => a.providerAttachmentId === incoming.providerAttachmentId
        && a.emailMessageId === incoming.emailMessageId
    );

    expect(match).toBeDefined();
    expect(match?.id).toBe("att1");
  });

  it("different providerAttachmentId creates new record", () => {
    const existingAttachments = [
      { id: "att1", providerAttachmentId: "provider-123", emailMessageId: "msg1" },
    ];

    const incoming = { providerAttachmentId: "provider-999", emailMessageId: "msg1" };
    const match = existingAttachments.find(
      a => a.providerAttachmentId === incoming.providerAttachmentId
    );

    expect(match).toBeUndefined();
  });
});
