import { describe, expect, it } from "vitest";
import { tasksForEmailJobLink } from "../task-job-link.js";

describe("tasksForEmailJobLink", () => {
  it("points every task from those emails at the job", () => {
    expect(
      tasksForEmailJobLink({
        workspaceId: "ws",
        sourceMessageIds: ["msg-1", "msg-2"],
        jobId: "job-1",
      })
    ).toEqual({
      where: { workspaceId: "ws", sourceMessageId: { in: ["msg-1", "msg-2"] } },
      data: { jobId: "job-1" },
    });
  });

  it("clears the job when the email is unassigned", () => {
    expect(
      tasksForEmailJobLink({
        workspaceId: "ws",
        sourceMessageIds: ["msg-1"],
        jobId: null,
      })?.data.jobId
    ).toBeNull();
  });

  it("skips an empty message list", () => {
    expect(
      tasksForEmailJobLink({ workspaceId: "ws", sourceMessageIds: [], jobId: "job-1" })
    ).toBeNull();
  });
});
