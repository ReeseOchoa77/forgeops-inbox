# Jobs (product)

Domain matching: [job-matching.md](../architecture/job-matching.md). Numbering is summarized here because UI create/restore depends on it.

## Job identity

| Field | Meaning |
|-------|---------|
| `jobNumber` | Internal ForgeOps number. Displayed as `#…`. **Never** inferred from external email text |
| `name` | Project name (unique per workspace via `normalizedName`) |
| `externalRef` | Deliberate external/GC identifier — valid matcher evidence |
| `siteName` | Site / campus identity |
| `status` | `LEAD` \| `BIDDING` \| `AWARDED` \| `ACTIVE` \| `ON_HOLD` \| `COMPLETE` \| `ARCHIVED` \| `COMPLETED` \| `CANCELLED` |
| `archivedAt` | Soft archive. Archived Jobs do not reserve numbers |

JobsView filters: ALL, BIDDING, ACTIVE, ON_HOLD, COMPLETE, ARCHIVED. Converted Bids create Jobs as **ACTIVE**, not BIDDING.

Live matcher pool: `ACTIVE` / `ON_HOLD` / `AWARDED` only.

## Jobs list Edit mode

The Jobs page is **read-only by default**. Clicking a row/name opens Job detail.

Users with Job edit permission (`OWNER` / `ADMIN` / `MEMBER`) can enable page-level **Edit** from the Jobs header controls (`Edit` ↔ `Done Editing`). Edit mode is local UI state only (not persisted).

When Edit mode is ON:

- Primary visible fields become inline-editable (click a field to open its control)
- Job number, Job/project name, Customer (`Job.customerId` via select-or-create), Start date
- Each field saves independently through the canonical `PUT /jobs/:jobId`
- Customer uses the shared select-or-create control (existing or explicit Create) — see [customers.md](customers.md)
- Row navigation into Job detail is paused to avoid accidental page changes
- Turning **Done Editing** saves any active field (if valid) before exiting; it does not silently discard

Deeper Job management (status beyond list ops, site, financials, aliases, members, documents, CRM tabs) remains on the Job detail page.

## Job numbering (verified)

Canonical helper: `packages/shared/src/bidding/suggest-next-job-number.ts`.

**Next Job number = highest numeric `jobNumber` among current (`archivedAt IS NULL`) Jobs in the workspace + 1.**

Archived Jobs **do not** participate in MAX and **do not reserve** numbers.

Example:

- Current: 1001, 1002, 1003
- Archived: 1004, 1005, 1050
- Next: **1004**

Gaps below max are **not** filled (`3000, 3002, 3003` → `3004`). Empty workspace → no suggestion (user must enter). Formats: plain digits or `yy-seq` (`26-200` → `26-201`). Suggestion does not reserve.

| Rule | Behavior |
|------|----------|
| Current/current duplicate | Rejected (`JOB_NUMBER_TAKEN`). App-level; no DB unique on `(workspaceId, jobNumber)` |
| Archived/current same number | Allowed |
| Restore archived Job | Refuses if another **current** Job has that number. **No silent renumber** |
| Bid convert | Requires user `jobNumber`; does not auto-pick next on collision |
| `BidCandidate.proposedJobNumber` | Ignored for numbering (becomes `externalRef` on convert) |

Applies to manual create, convert, intake, edits (including Jobs-list inline edit), restore — all current-collision checks use the same uniqueness helper.

## Email ↔ Job

Inbox Job filter uses `EmailMessage.jobId`. Manual assign is `USER_ASSIGNED` (authoritative). Matcher auto-assign is off.
