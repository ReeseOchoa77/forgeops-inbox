import { describe, expect, it } from "vitest";
import {
  HISTORICAL_IMPORT_MAX_LIMIT,
  shouldEnqueueNativeClassification,
  shouldRegisterNativePush,
  shouldRunNativeInboxSync,
  shouldScheduleNativeInboxSync,
} from "@forgeops/shared";

describe("mailbox control-plane safety gates", () => {
  it("OAuth-connected N8N mailbox cannot schedule, push, sync, or classify", () => {
    const afterOauth = {
      status: "ACTIVE",
      ingestionSource: "N8N",
      nativeListeningEnabled: false,
    };
    expect(shouldScheduleNativeInboxSync(afterOauth)).toBe(false);
    expect(shouldRegisterNativePush(afterOauth)).toBe(false);
    expect(shouldRunNativeInboxSync(afterOauth)).toBe(false);
    expect(shouldEnqueueNativeClassification(afterOauth)).toBe(false);
  });

  it("workspace-registered monitored mailbox defaults match OAuth-safe quiet state", () => {
    const registered = {
      status: "ACTIVE" as const,
      ingestionSource: "N8N" as const,
      nativeListeningEnabled: false,
    };
    expect(shouldScheduleNativeInboxSync(registered)).toBe(false);
    expect(shouldEnqueueNativeClassification(registered)).toBe(false);
  });

  it("listener OFF blocks automatic processing even in NATIVE mode", () => {
    const nativeQuiet = {
      status: "ACTIVE",
      ingestionSource: "NATIVE",
      nativeListeningEnabled: false,
    };
    expect(shouldScheduleNativeInboxSync(nativeQuiet)).toBe(false);
    expect(shouldRunNativeInboxSync(nativeQuiet)).toBe(false);
    // Manual historical import may still classify when mode is NATIVE
    expect(shouldEnqueueNativeClassification(nativeQuiet)).toBe(true);
  });

  it("listener ON + NATIVE enables automatic sync/push", () => {
    const live = {
      status: "ACTIVE",
      ingestionSource: "NATIVE",
      nativeListeningEnabled: true,
    };
    expect(shouldScheduleNativeInboxSync(live)).toBe(true);
    expect(shouldRegisterNativePush(live)).toBe(true);
    expect(shouldRunNativeInboxSync(live)).toBe(true);
  });

  it("historical import hard limit supports pagination beyond 25/50", () => {
    expect(HISTORICAL_IMPORT_MAX_LIMIT).toBeGreaterThanOrEqual(100);
    expect(HISTORICAL_IMPORT_MAX_LIMIT).toBe(250);
  });
});
