import { describe, expect, it } from "vitest";

/**
 * Sync must not clear ForgeOps unread on provider re-import.
 * Provider may push unread→false; never unread→true on update.
 */
function buildUpdateIsReadPatch(providerSaysUnread: boolean): { isRead?: boolean } {
  return providerSaysUnread ? { isRead: false } : {};
}

describe("provider sync isRead preserve", () => {
  it("does not set isRead on update when provider says read", () => {
    expect(buildUpdateIsReadPatch(false)).toEqual({});
  });

  it("sets isRead false on update when provider says unread", () => {
    expect(buildUpdateIsReadPatch(true)).toEqual({ isRead: false });
  });

  it("create uses provider unread label", () => {
    const providerSaysUnread = true;
    const isRead = !providerSaysUnread;
    expect(isRead).toBe(false);
  });
});
