import { describe, expect, it } from "vitest";

import { buildMessagesWhere } from "../interfaces/http/routes/inbox-read.route.js";
import { buildOperationalTasksWhere } from "@forgeops/shared";

describe("pinnedOnly list filters", () => {
  it("Inbox buildMessagesWhere includes isPinned when pinnedOnly", () => {
    const where = buildMessagesWhere({
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      reviewOnly: false,
      lowConfidenceOnly: false,
      pinnedOnly: true,
      classificationThreshold: 0.75 as never,
      taskThreshold: 0.75 as never,
    });
    expect(JSON.stringify(where)).toContain('"isPinned":true');
  });

  it("Inbox buildMessagesWhere omits isPinned when pinnedOnly off", () => {
    const where = buildMessagesWhere({
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      reviewOnly: false,
      lowConfidenceOnly: false,
      classificationThreshold: 0.75 as never,
      taskThreshold: 0.75 as never,
    });
    expect(JSON.stringify(where)).not.toContain('"isPinned":true');
  });

  it("Tasks buildOperationalTasksWhere includes isPinned when pinnedOnly", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      pinnedOnly: true,
    });
    expect(JSON.stringify(where)).toContain('"isPinned":true');
  });
});
