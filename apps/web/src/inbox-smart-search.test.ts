import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyParticipantToken,
  removeParticipantToken,
  resolveInboxSearchEnter,
  participantEmailsCacheKey,
  participantRoleForInbox,
} from "./inbox-smart-search";
import { buildInboxMessageListFilters } from "./inbox-message-list-filters";
import { inboxListQueryKey } from "./inbox-list-query";

const here = dirname(fileURLToPath(import.meta.url));
const connor = { email: "connorochoa@tekstl.net", name: "Connor Ochoa" };
const reese = { email: "reese.ochoa@neruanet.ai", name: "Reese Ochoa" };

describe("Inbox smart search tokenization", () => {
  it("1. stairway stays plain text — never a chip", () => {
    expect(applyParticipantToken([], { email: "stairway", name: null })).toEqual([]);
    expect(
      resolveInboxSearchEnter({
        draft: "stairway",
        suggestions: [connor],
        suggestionsOpen: false,
        activeIndex: 0,
      })
    ).toEqual({ action: "keep-text" });
  });

  it("2. Connor stays plain text until a suggestion is selected", () => {
    expect(applyParticipantToken([], { email: "Connor", name: "Connor Ochoa" })).toEqual(
      []
    );
    expect(
      resolveInboxSearchEnter({
        draft: "Connor",
        suggestions: [connor],
        suggestionsOpen: true,
        activeIndex: -1,
      })
    ).toEqual({ action: "keep-text" });
  });

  it("3. selecting a known email suggestion creates an email chip", () => {
    expect(applyParticipantToken([], connor)).toEqual([connor]);
  });

  it("4. email chip + normal text stay separate query fields", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
      activeSearch: "stairway",
      participantEmails: [connor.email],
    });
    expect(f.search).toBe("stairway");
    expect(f.fromEmails).toEqual([connor.email]);
    expect(f.toEmails).toBeUndefined();
  });

  it("5. multiple email chips + text: senders OR, AND content", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
      activeSearch: "stairway",
      participantEmails: [reese.email, connor.email],
    });
    expect(f.search).toBe("stairway");
    expect(f.fromEmails).toEqual([connor.email, reese.email]);
  });

  it("6. Enter on stairway does not create a chip", () => {
    const result = resolveInboxSearchEnter({
      draft: "stairway",
      suggestions: [],
      suggestionsOpen: false,
      activeIndex: -1,
    });
    expect(result).toEqual({ action: "keep-text" });
  });

  it("Enter on a complete known email commits a chip", () => {
    expect(
      resolveInboxSearchEnter({
        draft: "connorochoa@tekstl.net",
        suggestions: [connor],
        suggestionsOpen: false,
        activeIndex: -1,
      })
    ).toEqual({ action: "commit-token", participant: connor });
  });

  it("7. Enter on highlighted autocomplete email creates a chip", () => {
    const result = resolveInboxSearchEnter({
      draft: "conn",
      suggestions: [connor, reese],
      suggestionsOpen: true,
      activeIndex: 0,
    });
    expect(result).toEqual({ action: "commit-token", participant: connor });
  });

  it("8. removing an email chip leaves normal text", () => {
    const remaining = removeParticipantToken([connor, reese], connor.email);
    expect(remaining).toEqual([reese]);
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
      activeSearch: "stairway",
      participantEmails: remaining.map((t) => t.email),
    });
    expect(f.search).toBe("stairway");
    expect(f.fromEmails).toEqual([reese.email]);
  });

  it("9. normal text still maps to unified search", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
      activeSearch: "anchor bolts",
    });
    expect(f.search).toBe("anchor bolts");
    expect(f.fromEmails).toBeUndefined();
  });

  it("10. participant chips still map to sender/recipient filters", () => {
    const incoming = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
      participantEmails: [connor.email],
    });
    expect(incoming.fromEmails).toEqual([connor.email]);
    expect(incoming.toEmails).toBeUndefined();
    const sent = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "sent",
      participantEmails: [connor.email],
    });
    expect(sent.sentOnly).toBe(true);
    expect(sent.toEmails).toEqual([connor.email]);
    expect(sent.fromEmails).toBeUndefined();
  });

  it("cache keys distinguish sender sets independently of order", () => {
    const a = inboxListQueryKey(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        activeSearch: "stairway",
        participantEmails: [connor.email, reese.email],
      })
    );
    const b = inboxListQueryKey(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        activeSearch: "stairway",
        participantEmails: [reese.email, connor.email],
      })
    );
    const none = inboxListQueryKey(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        activeSearch: "stairway",
      })
    );
    expect(a).toBe(b);
    expect(a).not.toBe(none);
    expect(participantEmailsCacheKey([reese.email, connor.email])).toBe(
      participantEmailsCacheKey([connor.email, reese.email])
    );
    expect(participantRoleForInbox(false)).toBe("sender");
    expect(participantRoleForInbox(true)).toBe("recipient");
  });

  it("UI: only email tokens have an X; search input is text not search", () => {
    const searchSrc = readFileSync(join(here, "components/InboxSmartSearch.tsx"), "utf8");
    const viewSrc = readFileSync(join(here, "views/MessagesView.tsx"), "utf8");
    expect(viewSrc).toContain("InboxSmartSearch");
    expect(viewSrc).not.toContain('type="search"');
    expect(searchSrc).toContain('type="text"');
    expect(searchSrc).toContain('data-testid="inbox-participant-token"');
    expect(searchSrc).toContain("Remove ${token.email}");
    expect(searchSrc).toContain("{token.email}");
    expect(searchSrc).not.toContain("compactParticipantTokenLabel");
    expect(searchSrc).toContain("resolveInboxSearchEnter");
    expect(searchSrc).not.toContain('type="search"');
  });
});
