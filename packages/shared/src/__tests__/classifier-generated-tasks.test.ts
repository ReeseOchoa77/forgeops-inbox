import { describe, expect, it } from "vitest";
import {
  classifierGeneratedTaskKeyFilter,
  classifierGeneratedTasksForMessageWhere,
  DEFAULT_RECLASSIFY_TASK_MODE,
} from "../classifier-generated-tasks.js";

describe("classifier-generated task provenance", () => {
  it("defaults reclassify task mode to REMOVE_ONLY", () => {
    expect(DEFAULT_RECLASSIFY_TASK_MODE).toBe("REMOVE_ONLY");
  });

  it("matches only native: and heuristic-primary keys", () => {
    expect(classifierGeneratedTaskKeyFilter()).toEqual({
      OR: [
        { sourceTaskKey: { startsWith: "native:" } },
        { sourceTaskKey: "heuristic-primary" },
      ],
    });
  });

  it("scopes deletes to workspace + source message", () => {
    expect(
      classifierGeneratedTasksForMessageWhere({
        workspaceId: "ws",
        sourceMessageId: "m1",
      })
    ).toMatchObject({
      workspaceId: "ws",
      sourceMessageId: "m1",
    });
  });
});
