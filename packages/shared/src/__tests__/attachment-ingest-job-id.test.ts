import { describe, expect, it } from "vitest";
import { buildAttachmentIngestJobId } from "../constants/queues.js";

describe("buildAttachmentIngestJobId", () => {
  it("does not contain colon characters", () => {
    const jobId = buildAttachmentIngestJobId("cmt1nfdq5003kjgoc8d8o7001");
    expect(jobId).toBe("attachment-ingest-cmt1nfdq5003kjgoc8d8o7001");
    expect(jobId).not.toContain(":");
  });

  it("is deterministic for the same emailMessageId", () => {
    const id = "cmt1nfdq5003kjgoc8d8o7001";
    expect(buildAttachmentIngestJobId(id)).toBe(buildAttachmentIngestJobId(id));
  });

  it("differs across emailMessageIds", () => {
    expect(buildAttachmentIngestJobId("msg-a")).not.toBe(
      buildAttachmentIngestJobId("msg-b")
    );
  });
});
