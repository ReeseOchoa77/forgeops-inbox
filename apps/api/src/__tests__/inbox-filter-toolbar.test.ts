import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const messagesSrc = readFileSync(
  join(here, "../../../web/src/views/MessagesView.tsx"),
  "utf8"
);

describe("Inbox filter toolbar — compact mail + date dropdowns", () => {
  it("replaces read-state and date pill groups with accessible selects", () => {
    expect(messagesSrc).toContain('data-testid="inbox-mail-filter"');
    expect(messagesSrc).toContain('data-testid="inbox-date-filter"');
    expect(messagesSrc).toContain('aria-label="Mail filter"');
    expect(messagesSrc).toContain('aria-label="Date filter"');

    expect(messagesSrc).toContain('<option value="">All mail</option>');
    expect(messagesSrc).toContain('<option value="unread">Unread</option>');
    expect(messagesSrc).toContain('<option value="read">Read</option>');
    expect(messagesSrc).toContain('<option value="sent">Sent</option>');

    expect(messagesSrc).toContain('<option value="">All dates</option>');
    expect(messagesSrc).toContain('<option value="TODAY">Today</option>');
    expect(messagesSrc).toContain('<option value="WEEK">This week</option>');
    expect(messagesSrc).toContain('<option value="MONTH">This month</option>');

    expect(messagesSrc).not.toMatch(/\['',\s*'All'\],\s*\['unread',\s*'Unread'\]/);
    expect(messagesSrc).not.toMatch(/\['',\s*'All dates'\],\s*\['TODAY',\s*'Today'\]/);
  });

  it("keeps selectDirectionFilter + setDateRange wiring (independent filters)", () => {
    expect(messagesSrc).toContain("selectDirectionFilter");
    expect(messagesSrc).toContain("setDateRange");
    expect(messagesSrc).toContain(
      "onChange={(e) => selectDirectionFilter(e.target.value as ReadFilter)}"
    );
    expect(messagesSrc).toContain(
      "onChange={(e) => setDateRange(e.target.value as '' | 'TODAY' | 'WEEK' | 'MONTH')}"
    );
  });

  it("Sent composes with tabs — does not reset classification or hide tab active state", () => {
    expect(messagesSrc).toContain(
      "// Direction composes with the current tab/classification — do not reset them."
    );
    expect(messagesSrc).toContain(
      "// Tab/classification composes with the current direction (incl. Sent)."
    );
    expect(messagesSrc).not.toContain("Global Sent: clear Business/Personal category");
    expect(messagesSrc).not.toContain("Leaving Sent (or switching category) always clears sentOnly");
    expect(messagesSrc).toContain("const tabActive = inboxTab === tab.key");
    expect(messagesSrc).not.toContain("!isSentView && inboxTab === tab.key");
    expect(messagesSrc).toContain("const showBusinessChrome = isBusiness");
  });

  it("query-context changes clear stale rows (no soft cross-tab bleed)", () => {
    expect(messagesSrc).toContain("inboxListQueryKey");
    expect(messagesSrc).toContain("isSameInboxListQuery");
    expect(messagesSrc).toContain("activeQueryKeyRef");
    expect(messagesSrc).toContain("New tab/filter: paint cached rows immediately when available");
    expect(messagesSrc).toContain("setMessages([])");
    // Soft only when sameQuery
    expect(messagesSrc).toContain("sameQuery");
    expect(messagesSrc).toContain("{ soft: true }");
    expect(messagesSrc).toContain("{ soft: false }");
  });

  it("Job filter uses one control; No job lives in JobFilterSelect only", () => {
    const pickerSrc = readFileSync(
      join(here, "../../../web/src/components/JobAssignPicker.tsx"),
      "utf8"
    );
    // Standalone toolbar No job toggle removed
    expect(messagesSrc).not.toMatch(
      /onClick=\{\(\) => setJobFilter\(jobFilter === 'unassigned'/
    );
    expect(messagesSrc).not.toMatch(/>\s*No job\s*</);
    expect(messagesSrc).toContain("JobFilterSelect");

    // Dropdown label rename; value remains unassigned
    expect(pickerSrc).toContain('label="No job"');
    expect(pickerSrc).toContain("pick('unassigned')");
    expect(pickerSrc).toContain("? 'No job'");
    expect(pickerSrc).not.toMatch(/label="Unassigned"/);
    expect(pickerSrc).not.toMatch(/\? 'Unassigned'/);
  });
});
