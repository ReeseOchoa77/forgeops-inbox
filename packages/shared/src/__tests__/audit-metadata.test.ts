import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_METADATA_MAX_BYTES,
  AUDIT_OPERATIONAL_ACTIONS,
  AUDIT_OPERATIONAL_RETENTION_DAYS,
  buildInboxSyncSucceededAuditMetadata,
  isOperationalAuditAction,
  auditRetentionDaysForAction,
  sanitizeAuditMetadata,
} from "@forgeops/shared";

describe("buildInboxSyncSucceededAuditMetadata", () => {
  it("keeps compact metrics and omits cursors / ID arrays", () => {
    const metadata = buildInboxSyncSucceededAuditMetadata({
      provider: "outlook",
      jobId: "job-1",
      refreshTokenRotated: false,
      syncCursorAdvanced: true,
      threadsImported: 2,
      messagesImported: 5,
      duplicatesSkipped: 1,
      createdCount: 5,
      updatedCount: 1,
      duplicateCount: 1,
      attachmentIngestCandidateCount: 3,
      skippedClearedCount: 10,
    });

    const json = JSON.stringify(metadata);
    expect(json).not.toContain("newestSyncCursor");
    expect(json).not.toContain("createdMessageIds");
    expect(json).not.toContain("updatedMessageIds");
    expect(json).not.toContain("duplicateMessageIds");
    expect(json).not.toContain("attachmentIngestCandidates");
    expect(json).not.toContain("workspaceId");
    expect(json).not.toContain("inboxConnectionId");
    expect(metadata).toMatchObject({
      provider: "outlook",
      jobId: "job-1",
      syncCursorAdvanced: true,
      createdCount: 5,
      attachmentIngestCandidateCount: 3,
      skippedClearedCount: 10,
    });
    expect(Buffer.byteLength(json, "utf8")).toBeLessThan(1024);
  });
});

describe("sanitizeAuditMetadata", () => {
  it("strips sync cursors and tokens", () => {
    const { metadata, strippedKeys } = sanitizeAuditMetadata({
      newestSyncCursor: "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=" + "x".repeat(80_000),
      refreshToken: "secret",
      messagesImported: 3,
    });
    expect(metadata.messagesImported).toBe(3);
    expect(metadata.newestSyncCursor).toBeUndefined();
    expect(metadata.newestSyncCursorOmitted).toBe(true);
    expect(metadata.refreshTokenOmitted).toBe(true);
    expect(strippedKeys.some((k) => /cursor|token/i.test(k))).toBe(true);
  });

  it("collapses unbounded arrays", () => {
    const { metadata } = sanitizeAuditMetadata({
      createdMessageIds: Array.from({ length: 100 }, (_, i) => `id-${i}`),
    });
    expect(metadata.createdMessageIds).toEqual({ count: 100, omitted: true });
  });

  it("truncates when over hard max and warns", () => {
    const onWarn = vi.fn();
    const huge: Record<string, unknown> = { provider: "outlook" };
    // Many mid-size non-sensitive strings that individually pass the 2KB string
    // cap but together exceed AUDIT_METADATA_MAX_BYTES.
    for (let i = 0; i < 20; i += 1) {
      huge[`note${i}`] = "z".repeat(1200);
    }
    const result = sanitizeAuditMetadata(huge, { onWarn });
    expect(result.truncated).toBe(true);
    expect(result.warned).toBe(true);
    expect(result.metadata._auditMetadataTruncated).toBe(true);
    expect(result.metadata.provider).toBe("outlook");
    expect(onWarn).toHaveBeenCalled();
    expect(result.byteLength).toBeLessThan(AUDIT_METADATA_MAX_BYTES);
  });

  it("never keeps bodyHtml content", () => {
    const { metadata } = sanitizeAuditMetadata({
      attachmentIngestCandidates: [
        { emailMessageId: "m1", bodyHtml: "<p>huge secret body</p>" },
      ],
    });
    const json = JSON.stringify(metadata);
    expect(json).not.toContain("<p>huge");
    expect(json).not.toContain("secret body");
    expect(metadata.attachmentIngestCandidates).toEqual([
      expect.objectContaining({
        emailMessageId: "m1",
        bodyHtmlOmitted: true,
      }),
    ]);
  });
});

describe("audit retention classifier", () => {
  it("marks sync/view/analysis as operational with 30-day retention", () => {
    for (const action of AUDIT_OPERATIONAL_ACTIONS) {
      expect(isOperationalAuditAction(action)).toBe(true);
      expect(auditRetentionDaysForAction(action)).toBe(
        AUDIT_OPERATIONAL_RETENTION_DAYS
      );
    }
  });

  it("keeps security/compliance actions durable", () => {
    for (const action of [
      "auth.signed_in",
      "inbox_connection.sync_failed",
      "inbox_connection.cleared",
      "email.message.sent",
      "classification.corrected",
    ]) {
      expect(isOperationalAuditAction(action)).toBe(false);
      expect(auditRetentionDaysForAction(action)).toBeNull();
    }
  });
});
