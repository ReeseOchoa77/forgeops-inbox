import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const messagesSrc = readFileSync(
  join(here, "../../../web/src/views/MessagesView.tsx"),
  "utf8"
);

function toolbarRows(src: string): { primary: string; secondary: string } {
  const primaryStart = src.indexOf('data-testid="inbox-filter-row-primary"');
  const secondaryStart = src.indexOf('data-testid="inbox-filter-row-secondary"');
  const toolbarEnd = src.indexOf("{/* Message list */}");
  return {
    primary: src.slice(primaryStart, secondaryStart),
    secondary: src.slice(
      secondaryStart,
      toolbarEnd > secondaryStart ? toolbarEnd : src.length
    ),
  };
}

describe("Inbox filter toolbar — two-row compact layout", () => {
  it("primary row: Business, Sent, Personal, Active Bid/Quote, Trash", () => {
    const { primary } = toolbarRows(messagesSrc);
    expect(messagesSrc).toContain('data-testid="inbox-filter-row-primary"');
    expect(primary).toContain('data-testid="inbox-primary-business"');
    expect(primary).toContain('data-testid="inbox-primary-sent"');
    expect(primary).toContain('data-testid="inbox-primary-personal"');
    expect(primary).toContain('data-testid="inbox-active-bid-filter"');
    expect(primary).toContain('data-testid="inbox-quote-filter"');
    expect(primary).toContain('data-testid="inbox-primary-trash"');
    expect(primary).not.toContain('data-testid="inbox-primary-unclassified"');
    expect(primary).not.toContain('data-testid="inbox-pinned-filter"');
    expect(primary).not.toContain('data-testid="inbox-unread-filter"');
    expect(primary).not.toContain("JobFilterSelect");
    expect(primary).not.toContain("InboxDateSelect");
    expect(primary).not.toContain("InboxPrioritySelect");
    expect(primary).not.toContain("InboxSubtypeSelect");
    expect(messagesSrc).not.toContain('<option value="">All dates</option>');
    expect(messagesSrc).not.toContain("All Jobs");
  });

  it("secondary row: Unread, Pinned, Jobs, Dates, Priority, Subtype", () => {
    const { primary, secondary } = toolbarRows(messagesSrc);
    expect(messagesSrc).toContain('data-testid="inbox-filter-row-secondary"');
    expect(secondary).toContain('data-testid="inbox-pinned-filter"');
    expect(secondary).toContain('data-testid="inbox-unread-filter"');
    expect(secondary.indexOf("inbox-unread-filter")).toBeLessThan(
      secondary.indexOf("inbox-pinned-filter")
    );
    expect(secondary).toContain("JobFilterSelect");
    expect(secondary).toContain("InboxDateSelect");
    expect(secondary).toContain("InboxPrioritySelect");
    expect(secondary).toContain("InboxSubtypeSelect");
    expect(primary).not.toContain("JobFilterSelect");
    expect(primary).not.toContain("InboxDateSelect");
    expect(primary).not.toContain('data-testid="inbox-pinned-filter"');
    expect(secondary.split("<JobFilterSelect").length - 1).toBe(1);
    expect(secondary.split("<InboxDateSelect").length - 1).toBe(1);
    expect(messagesSrc).toContain('testId="inbox-date-filter"');
    expect(messagesSrc).toContain('testId="inbox-priority-filter"');
    expect(messagesSrc).toContain('testId="inbox-subtype-filter"');
    expect(messagesSrc).not.toContain('data-testid="inbox-read-filter"');
    expect(messagesSrc).not.toContain('<option value="">All mail</option>');
  });

  it("Exclude control removed from MessagesView", () => {
    expect(messagesSrc).not.toContain("InboxExcludeFilter");
    expect(messagesSrc).not.toContain("excludeBusinessTypeGroups");
  });

  it("keeps selectDirectionFilter + setDateRange wiring", () => {
    expect(messagesSrc).toContain("selectDirectionFilter");
    expect(messagesSrc).toContain("setDateRange");
    expect(messagesSrc).toContain("InboxDateSelect");
  });

  it("Sent composes with tabs — Quote cleared when leaving Sent", () => {
    expect(messagesSrc).toContain(
      "// Tab/classification composes with the current direction (incl. Sent)."
    );
    expect(messagesSrc).toContain(
      "leavingSent && prev === 'ESTIMATE_QUOTE'"
    );
    expect(messagesSrc).toContain("const showBusinessChrome = isBusiness");
  });

  it("query-context changes clear stale rows (no soft cross-tab bleed)", () => {
    expect(messagesSrc).toContain("inboxListQueryKey");
    expect(messagesSrc).toContain("isSameInboxListQuery");
    expect(messagesSrc).toContain("activeQueryKeyRef");
    expect(messagesSrc).toContain("New tab/filter: paint cached rows immediately when available");
    expect(messagesSrc).toContain("setMessages([])");
    expect(messagesSrc).toContain("sameQuery");
    expect(messagesSrc).toContain("{ soft: true }");
    expect(messagesSrc).toContain("{ soft: false }");
  });

  it("Job filter uses one control; No job lives in JobFilterSelect only", () => {
    const pickerSrc = readFileSync(
      join(here, "../../../web/src/components/JobAssignPicker.tsx"),
      "utf8"
    );
    expect(messagesSrc).not.toMatch(
      /onClick=\{\(\) => setJobFilter\(jobFilter === 'unassigned'/
    );
    expect(messagesSrc).not.toMatch(/>\s*No job\s*</);
    expect(messagesSrc).toContain("JobFilterSelect");

    expect(pickerSrc).toContain('label="No job"');
    expect(pickerSrc).toContain("pick('unassigned')");
    expect(pickerSrc).toContain("? 'No job'");
    expect(pickerSrc).toContain("? 'Jobs'");
    expect(pickerSrc).not.toMatch(/label="Unassigned"/);
    expect(pickerSrc).not.toMatch(/\? 'Unassigned'/);
  });
});
