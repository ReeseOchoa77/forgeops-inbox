import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AttachmentIngestJobPayload } from "@forgeops/shared";
import { AttachmentIngestionService } from "../application/services/attachment-ingestion.service.js";

function makePrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    inboxConnection: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    emailMessage: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    emailAttachment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    ...overrides,
  } as never;
}

describe("AttachmentIngestionService", () => {
  const tokenCipher = {
    decrypt: vi.fn(() => "refresh-token"),
    encrypt: vi.fn((v: string) => `enc:${v}`),
  };

  const outlookClient = {
    isConfigured: vi.fn(() => true),
    acquireAccessToken: vi.fn(async () => ({
      accessToken: "access",
      expiresAt: new Date(),
      refreshedRefreshToken: null,
    })),
    listAttachments: vi.fn(),
    downloadAttachment: vi.fn(),
  };

  const storage = {
    configured: true,
    upload: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
    delete: vi.fn(),
    getSignedDownloadUrl: vi.fn(),
    getObject: vi.fn(),
  };

  const payload: AttachmentIngestJobPayload = {
    workspaceId: "ws1",
    inboxConnectionId: "conn1",
    emailMessageId: "msg1",
    providerMessageId: "AAMkProvider",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when mailbox has no refresh token", async () => {
    const prisma = makePrismaMock();
    (prisma.inboxConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "conn1",
      provider: "OUTLOOK",
      status: "ACTIVE",
      encryptedRefreshToken: null,
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
    });

    const service = new AttachmentIngestionService(
      prisma,
      tokenCipher as never,
      outlookClient as never,
      storage as never,
      25 * 1024 * 1024
    );

    const result = await service.process(payload);
    expect(result.status).toBe("skipped_no_token");
    expect(outlookClient.listAttachments).not.toHaveBeenCalled();
  });

  it("inspects inline-only mail when hasAttachments is false but HTML has cid", async () => {
    const prisma = makePrismaMock();
    (prisma.inboxConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "conn1",
      provider: "OUTLOOK",
      status: "ACTIVE",
      encryptedRefreshToken: "enc",
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
    });
    (prisma.emailMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg1",
      gmailMessageId: "AAMkProvider",
      providerMessageId: "AAMkProvider",
      hasAttachments: false,
      bodyHtml: `<img src="cid:image001.jpg@01DD28E1.71648A70">`,
    });
    outlookClient.listAttachments.mockResolvedValue({
      ok: true,
      attachments: [
        {
          attachmentId: "att-inline-1",
          contentId: "image001.jpg@01DD28E1.71648A70",
          filename: "image001.jpg",
          inline: true,
          mimeType: "image/jpeg",
          size: 1200,
          odataType: "#microsoft.graph.fileAttachment",
        },
      ],
    });
    outlookClient.downloadAttachment.mockResolvedValue({
      ok: true,
      data: Buffer.from("jpeg-bytes"),
      contentType: "image/jpeg",
    });
    (prisma.emailAttachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.emailAttachment.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.emailMessage.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.inboxConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const service = new AttachmentIngestionService(
      prisma,
      tokenCipher as never,
      outlookClient as never,
      storage as never,
      25 * 1024 * 1024
    );

    const result = await service.process(payload);
    expect(result.status).toBe("completed");
    expect(result.uploadedCount).toBe(1);
    expect(prisma.emailAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isInline: true,
          contentId: "image001.jpg@01DD28E1.71648A70",
          mimeType: "image/jpeg",
          uploadStatus: "UPLOADED",
          providerAttachmentId: "att-inline-1",
        }),
      })
    );
  });

  it("processes mixed regular + inline attachments once", async () => {
    const prisma = makePrismaMock();
    (prisma.inboxConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "conn1",
      provider: "OUTLOOK",
      status: "ACTIVE",
      encryptedRefreshToken: "enc",
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
    });
    (prisma.emailMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg1",
      gmailMessageId: "AAMkProvider",
      providerMessageId: null,
      hasAttachments: true,
      bodyHtml: `<img src="cid:sig.png@abc"><p>see PDF</p>`,
    });
    outlookClient.listAttachments.mockResolvedValue({
      ok: true,
      attachments: [
        {
          attachmentId: "pdf-1",
          contentId: null,
          filename: "quote.pdf",
          inline: false,
          mimeType: "application/pdf",
          size: 5000,
          odataType: "#microsoft.graph.fileAttachment",
        },
        {
          attachmentId: "img-1",
          contentId: null,
          filename: "photo.png",
          inline: false,
          mimeType: "image/png",
          size: 2000,
          odataType: "#microsoft.graph.fileAttachment",
        },
        {
          attachmentId: "inline-1",
          contentId: "sig.png@abc",
          filename: "sig.png",
          inline: true,
          mimeType: "image/png",
          size: 800,
          odataType: "#microsoft.graph.fileAttachment",
        },
      ],
    });
    outlookClient.downloadAttachment.mockImplementation(async (_t, _m, id: string) => ({
      ok: true as const,
      data: Buffer.from(`bytes-${id}`),
      contentType: "application/octet-stream",
    }));
    (prisma.emailAttachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.emailAttachment.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.emailMessage.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.inboxConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const service = new AttachmentIngestionService(
      prisma,
      tokenCipher as never,
      outlookClient as never,
      storage as never,
      25 * 1024 * 1024
    );

    const result = await service.process(payload);
    expect(result.listedCount).toBe(3);
    expect(result.uploadedCount).toBe(3);
    expect(outlookClient.downloadAttachment).toHaveBeenCalledTimes(3);
  });

  it("processes non-inline ZIP attachment to UPLOADED EmailAttachment row", async () => {
    const prisma = makePrismaMock();
    (prisma.inboxConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "conn1",
      provider: "OUTLOOK",
      status: "ACTIVE",
      encryptedRefreshToken: "enc",
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
    });
    (prisma.emailMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg1",
      gmailMessageId: "AAMkProvider",
      providerMessageId: "AAMkProvider",
      hasAttachments: true,
      bodyHtml: null,
    });
    outlookClient.listAttachments.mockResolvedValue({
      ok: true,
      attachments: [
        {
          attachmentId: "zip-graph-1",
          contentId: null,
          filename: "8-26-26_Beltline Parking Ramp_Stair C_Fab.zip",
          inline: false,
          mimeType: "application/zip",
          size: 50_000,
          odataType: "#microsoft.graph.fileAttachment",
        },
      ],
    });
    outlookClient.downloadAttachment.mockResolvedValue({
      ok: true,
      data: Buffer.from("PK\x03\x04zip"),
      contentType: "application/zip",
    });
    (prisma.emailAttachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.emailAttachment.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.emailMessage.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.inboxConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const service = new AttachmentIngestionService(
      prisma,
      tokenCipher as never,
      outlookClient as never,
      storage as never,
      25 * 1024 * 1024
    );

    const result = await service.process(payload);
    expect(result.status).toBe("completed");
    expect(result.uploadedCount).toBe(1);
    expect(prisma.emailAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isInline: false,
          filename: "8-26-26_Beltline Parking Ramp_Stair C_Fab.zip",
          mimeType: "application/zip",
          uploadStatus: "UPLOADED",
          providerAttachmentId: "zip-graph-1",
        }),
      })
    );
  });

  it("is idempotent: skips re-download when UPLOADED object still exists", async () => {
    const prisma = makePrismaMock();
    (prisma.inboxConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "conn1",
      provider: "OUTLOOK",
      status: "ACTIVE",
      encryptedRefreshToken: "enc",
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
    });
    (prisma.emailMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg1",
      gmailMessageId: "AAMkProvider",
      providerMessageId: "AAMkProvider",
      hasAttachments: true,
      bodyHtml: null,
    });
    outlookClient.listAttachments.mockResolvedValue({
      ok: true,
      attachments: [
        {
          attachmentId: "pdf-1",
          contentId: null,
          filename: "quote.pdf",
          inline: false,
          mimeType: "application/pdf",
          size: 5000,
          odataType: "#microsoft.graph.fileAttachment",
        },
      ],
    });
    (prisma.emailAttachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "existing",
      uploadStatus: "UPLOADED",
      storageKey: "attachments/ws1/msg1/existing/quote.pdf",
      contentId: null,
      isInline: false,
      mimeType: "application/pdf",
    });
    storage.exists.mockResolvedValue(true);
    (prisma.emailMessage.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.inboxConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const service = new AttachmentIngestionService(
      prisma,
      tokenCipher as never,
      outlookClient as never,
      storage as never,
      25 * 1024 * 1024
    );

    const result = await service.process(payload);
    expect(result.skippedExistingCount).toBe(1);
    expect(result.uploadedCount).toBe(0);
    expect(outlookClient.downloadAttachment).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("throws on Graph list failure so BullMQ can retry (not empty)", async () => {
    const prisma = makePrismaMock();
    (prisma.inboxConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "conn1",
      provider: "OUTLOOK",
      status: "ACTIVE",
      encryptedRefreshToken: "enc",
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
    });
    (prisma.emailMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg1",
      gmailMessageId: "AAMkProvider",
      providerMessageId: "AAMkProvider",
      hasAttachments: true,
      bodyHtml: null,
    });
    (prisma.inboxConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    outlookClient.listAttachments.mockResolvedValue({
      ok: false,
      status: 429,
      error: "Outlook listAttachments failed (429): MailboxConcurrency",
    });

    const service = new AttachmentIngestionService(
      prisma,
      tokenCipher as never,
      outlookClient as never,
      storage as never,
      25 * 1024 * 1024
    );

    await expect(service.process(payload)).rejects.toThrow(/429|MailboxConcurrency/i);
  });

  it("keeps successful attachment when another fails", async () => {
    const prisma = makePrismaMock();
    (prisma.inboxConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "conn1",
      provider: "OUTLOOK",
      status: "ACTIVE",
      encryptedRefreshToken: "enc",
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
    });
    (prisma.emailMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg1",
      gmailMessageId: "AAMkProvider",
      providerMessageId: "AAMkProvider",
      hasAttachments: true,
      bodyHtml: null,
    });
    outlookClient.listAttachments.mockResolvedValue({
      ok: true,
      attachments: [
        {
          attachmentId: "ok-1",
          contentId: null,
          filename: "ok.pdf",
          inline: false,
          mimeType: "application/pdf",
          size: 100,
          odataType: "#microsoft.graph.fileAttachment",
        },
        {
          attachmentId: "bad-1",
          contentId: null,
          filename: "bad.pdf",
          inline: false,
          mimeType: "application/pdf",
          size: 100,
          odataType: "#microsoft.graph.fileAttachment",
        },
      ],
    });
    outlookClient.downloadAttachment.mockImplementation(async (_t, _m, id: string) => {
      if (id === "bad-1") {
        return { ok: false as const, status: 500, error: "download failed" };
      }
      return { ok: true as const, data: Buffer.from("pdf"), contentType: "application/pdf" };
    });
    (prisma.emailAttachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.emailAttachment.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.emailMessage.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.inboxConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const service = new AttachmentIngestionService(
      prisma,
      tokenCipher as never,
      outlookClient as never,
      storage as never,
      25 * 1024 * 1024
    );

    const result = await service.process(payload);
    expect(result.status).toBe("completed_with_failures");
    expect(result.uploadedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });
});
