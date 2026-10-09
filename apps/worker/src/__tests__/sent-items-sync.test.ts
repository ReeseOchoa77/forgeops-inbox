import { describe, expect, it } from "vitest";
import { mergeInboxSyncImports } from "../application/processors/inbox-sync.processor.js";
import { mergeEmailDirection } from "../application/services/email-direction.js";

describe("Outlook Sent Items sync wiring", () => {
  it("mergeInboxSyncImports combines created ids without duplicates", () => {
    const inbox = {
      workspaceId: "ws",
      inboxConnectionId: "conn",
      threadsImported: 1,
      messagesImported: 2,
      duplicatesSkipped: 0,
      createdMessageIds: ["a", "b"],
      updatedMessageIds: ["x"],
      duplicateMessageIds: [],
      newestSyncCursor: "inbox-delta",
      attachmentIngestCandidates: [
        {
          emailMessageId: "a",
          providerMessageId: "p1",
          hasAttachments: true,
          bodyHtml: null,
        },
      ],
      skippedClearedCount: 0,
    };
    const sent = {
      ...inbox,
      threadsImported: 1,
      messagesImported: 1,
      createdMessageIds: ["b", "c"],
      updatedMessageIds: ["y"],
      newestSyncCursor: "sent-delta",
      attachmentIngestCandidates: [
        {
          emailMessageId: "c",
          providerMessageId: "p2",
          hasAttachments: false,
          bodyHtml: null,
        },
      ],
    };
    const merged = mergeInboxSyncImports(inbox, sent);
    expect(merged.createdMessageIds).toEqual(["a", "b", "c"]);
    expect(merged.messagesImported).toBe(3);
    expect(merged.newestSyncCursor).toBe("inbox-delta");
    expect(merged.attachmentIngestCandidates).toHaveLength(2);
  });

  it("mergeInboxSyncImports with null sent returns inbox only", () => {
    const inbox = {
      workspaceId: "ws",
      inboxConnectionId: "conn",
      threadsImported: 0,
      messagesImported: 0,
      duplicatesSkipped: 0,
      createdMessageIds: [],
      updatedMessageIds: [],
      duplicateMessageIds: [],
      newestSyncCursor: null,
      attachmentIngestCandidates: [],
      skippedClearedCount: 0,
    };
    expect(mergeInboxSyncImports(inbox, null)).toBe(inbox);
  });

  it("Sent Items direction is sticky across Project Folder rediscovery", () => {
    expect(
      mergeEmailDirection({ existing: "SENT", incoming: "RECEIVED" })
    ).toBe("SENT");
  });
});

describe("task extraction prompt includes SENT semantics", () => {
  it("documents outbound request vs commitment", async () => {
    const { taskExtractionSystemPrompt, buildTaskExtractionUserPrompt } =
      await import("@forgeops/ai");
    expect(taskExtractionSystemPrompt).toMatch(/SENT OUTBOUND REQUEST/i);
    expect(taskExtractionSystemPrompt).toMatch(/SENT COMMITMENT/i);
    expect(taskExtractionSystemPrompt).toMatch(/Do NOT create a ForgeOps task/i);
    const user = buildTaskExtractionUserPrompt({
      normalizedSubject: "Drawings",
      senderEmail: "estimating@company.com",
      cleanBody: "Can you send us the updated drawings by Friday?",
      containsActionRequest: true,
      direction: "SENT",
      monitoredMailboxEmail: "estimating@company.com",
      toAddresses: ["gc@external.com"],
    });
    expect(user).toContain("Email Direction: SENT");
    expect(user).toContain("Monitored Mailbox: estimating@company.com");
    expect(user).toContain("To: gc@external.com");
  });
});
