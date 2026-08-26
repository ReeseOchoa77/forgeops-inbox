import { describe, expect, it } from "vitest";
import {
  MONITORED_MAILBOX_CREATE_DEFAULTS,
  resolveMonitoredMailboxRegistration,
} from "../application/services/register-monitored-mailbox.js";
import {
  assertTargetedMailboxEmailMatch,
} from "../application/services/inbox-authorization-status.js";
import {
  shouldEnqueueNativeClassification,
  shouldRegisterNativePush,
  shouldRunNativeInboxSync,
  shouldScheduleNativeInboxSync,
} from "@forgeops/shared";

describe("register monitored mailbox", () => {
  it("creates when member is active and no connection exists", () => {
    const result = resolveMonitoredMailboxRegistration({
      requestedEmail: "Ed@Tekstl.net",
      workspaceId: "ws1",
      approvedAccessActive: true,
      existingByProviderEmail: null,
    });
    expect(result).toEqual({
      ok: true,
      action: "create",
      normalizedEmail: "ed@tekstl.net",
    });
  });

  it("reuses existing same-workspace connection instead of duplicating", () => {
    const result = resolveMonitoredMailboxRegistration({
      requestedEmail: "ed@tekstl.net",
      workspaceId: "ws1",
      approvedAccessActive: true,
      existingByProviderEmail: {
        id: "conn1",
        workspaceId: "ws1",
        provider: "OUTLOOK",
        email: "ed@tekstl.net",
        status: "ACTIVE",
        ingestionSource: "N8N",
        nativeListeningEnabled: false,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("reuse");
      if (result.action === "reuse") {
        expect(result.connection.id).toBe("conn1");
      }
    }
  });

  it("rejects when email is not an active team member", () => {
    const result = resolveMonitoredMailboxRegistration({
      requestedEmail: "stranger@tekstl.net",
      workspaceId: "ws1",
      approvedAccessActive: false,
      existingByProviderEmail: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.statusCode).toBe(400);
  });

  it("rejects cross-workspace mailbox claim", () => {
    const result = resolveMonitoredMailboxRegistration({
      requestedEmail: "ed@tekstl.net",
      workspaceId: "ws1",
      approvedAccessActive: true,
      existingByProviderEmail: {
        id: "conn1",
        workspaceId: "ws-other",
        provider: "OUTLOOK",
        email: "ed@tekstl.net",
        status: "ACTIVE",
        ingestionSource: "N8N",
        nativeListeningEnabled: false,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.statusCode).toBe(409);
  });

  it("defaults new mailboxes to N8N + listening OFF (no native processing)", () => {
    expect(MONITORED_MAILBOX_CREATE_DEFAULTS).toEqual({
      ingestionSource: "N8N",
      nativeListeningEnabled: false,
      status: "ACTIVE",
    });
    expect(shouldScheduleNativeInboxSync(MONITORED_MAILBOX_CREATE_DEFAULTS)).toBe(false);
    expect(shouldRegisterNativePush(MONITORED_MAILBOX_CREATE_DEFAULTS)).toBe(false);
    expect(shouldRunNativeInboxSync(MONITORED_MAILBOX_CREATE_DEFAULTS)).toBe(false);
    expect(shouldEnqueueNativeClassification(MONITORED_MAILBOX_CREATE_DEFAULTS)).toBe(false);
  });

  it("preserves identity mismatch rejection for targeted OAuth", () => {
    const err = assertTargetedMailboxEmailMatch({
      expectedEmail: "ed@tekstl.net",
      microsoftEmail: "other@tekstl.net",
    });
    expect(err).toBeTruthy();
    expect(
      assertTargetedMailboxEmailMatch({
        expectedEmail: "ed@tekstl.net",
        microsoftEmail: "Ed@Tekstl.net",
      })
    ).toBeNull();
  });
});
