# Workspace State Persistence

**Status:** IMPLEMENTED (client helpers + surface wiring). Long-running Intelligence evaluations remain **sync HTTP** — they do **not** survive refresh via browser storage.

Related: [overview.md](overview.md), [intelligence-registry.md](intelligence-registry.md), [job-matching.md](job-matching.md).

## Goal

Refreshing the browser **and** navigating away/back within the SPA should restore the user’s working context when doing so is **safe, meaningful, and truthful**.

Navigating away from a workspace must not feel like closing it.

Do **not** dump the whole app into `localStorage`. Do **not** keep every route mounted forever.

Different categories use different mechanisms.

## State categories

| Category | Examples | Persistence |
|----------|----------|-------------|
| 1. Route / navigation | Page, Intelligence component id, detail tab | URL query (`view`, `intel`, `intelTab`) + scoped localStorage backup |
| 2. Shareable filter / query | Inbox category/filters, Jobs filters, eval outcome filter | Prefer URL when compact; otherwise scoped localStorage |
| 3. Workspace UI prefs | Inspector tab, Emails vs Jobs view, density | Scoped localStorage |
| 4. Draft / unsaved input | Job Matcher eval configuration before run | Scoped localStorage (config only) |
| 5. Durable operations | Long evals, worker jobs | **Server run/task identity only** — never faked in localStorage |
| 6. SPA session memory | Completed Job Matcher results, scroll tops, in-flight eval Promise | In-memory Maps (`session-memory.ts`) — survive remount, **not** refresh |

## Precedence

1. Explicit URL state  
2. Valid persisted workspace state  
3. Application defaults  

URL wins over localStorage for the same field (e.g. `intelTab=evaluation` overrides stored tab).

## Browser persistence helper

Code: `apps/web/src/workspace-state/`.

Key shape:

```text
forgeops:ws:<workspaceId>:u:<userId>:<surface>
```

Envelope:

```ts
{ v: number, workspaceId, userId, updatedAt, data }
```

Responsibilities:

- Namespace keys by workspace + user + surface
- Schema version (`v`) — mismatch → ignore safely
- Validate before apply; invalid → defaults
- Never store secrets, tokens, email bodies, or attachment content

## Surfaces (V1)

### Navigation (`nav`)

- Restores restorable pages (`inbox`, `jobs`, `intelligence`, …)
- Does **not** restore ephemeral shells (`message-detail`, `job-detail`)
- OAuth `connected` / `connection_error` redirects skip nav restore

### Inbox (`inbox-filters`)

Persists: tab/category, Sent/Unread, pinned, priority keys, job filter, subtype/Active Bid key, search, date range, participant emails.

Rules:

- Filtering remains **server-side before pagination**
- Restore triggers the canonical list query (not cached bodies as truth)
- Sent + Quote / Active Bid normalization still applies
- Hidden `UNCLASSIFIED` tab is **not** restored

### Jobs (`jobs-filters`)

Persists: search, status, customer, assignee, overdue, archived, sort.

**Edit Mode is not restored** — reload always returns Edit Mode OFF.

### Active Bids (`bidding-filters`) / Tasks (`tasks-filters`)

Persist list refinements that are useful across reload. Transient create/bulk modals are not persisted.

### Intelligence (`intelligence`)

- Selected component via nav (`intel` / `intelligenceId`)
- Detail tab via `intelTab` + localStorage
- Job Matcher eval **configuration** + result UI prefs (outcome filter, Emails/Jobs view, inspector tab, selected result **id**)

**localStorage does not store:** evaluation result rows, email bodies, or fabricated RUNNING flags.

**SPA session memory does store:** the latest completed Job Matcher evaluation summary/result for the workspace+user (no email bodies), plus scroll tops and an in-flight evaluate Promise handle.

## Navigation vs browser reload

| Event | Mechanism |
|-------|-----------|
| In-app leave/return | Module list caches (SWR) + `session-memory` (eval results, scrolls) + localStorage filters/tabs |
| Browser refresh | localStorage/URL for filters/config/tabs; **eval results cleared** (no server run id yet) |

## Keep-alive policy

| Surface | Keep mounted while hidden? | Why |
|---------|----------------------------|-----|
| Inbox during message-detail (from Inbox) | **Yes** (`display:none`) | Existing pattern — preserves list scroll without retaining other pages |
| Intelligence / Job Matcher | **No** | Results restored via session memory; avoid retaining email HTML DOM + listeners |
| Jobs / Bids / Tasks / Customers | **No** | Filters in localStorage; list Maps soft-hydrate; Edit Mode stays off |

Hidden pages must not keep polling. Worker Jobs / import polls stop on unmount today — keep that.

## Long-running evaluation (Job Matcher)

Current architecture:

```text
POST .../intelligence/job-matcher/evaluate
  → synchronous response (TOTAL samples ≤1000; ALL_ELIGIBLE uncapped)
  → React state + SPA session memory (navigation)
  → lost on full browser refresh (no EvaluationRun id)
```

There is **no** EvaluationRun / worker job id for Manage → Intelligence evaluation today.

Therefore:

- **In-app navigation:** completed results restore from session memory; in-flight Promise can re-attach
- **Browser refresh:** configuration restores; results do **not** — user re-runs
- Do **not** store `busy: true` in localStorage and claim a run is active

If durable cross-reload runs are required later: reuse Worker Jobs / analysis-run patterns. **Stop and design** before adding a new `EvaluationRun` table.

## Reset / clear

Changing filters to defaults and persisting (or calling `clear*State`) must leave localStorage consistent so reload does not resurrect old filters.

## Logout / security

Keys are scoped by `userId` + `workspaceId`. Switching workspace never applies another workspace’s Job IDs. Do not persist OAuth tokens, API keys, or full email content through this feature.

## Definition of done (new surfaces)

When adding filters, tabs, or analysis UI:

- [ ] Classify state (route / filter / pref / draft / durable op)
- [ ] URL for navigation/shareable filters where practical
- [ ] Scoped versioned helper for UI prefs/drafts
- [ ] Validate restored IDs against current workspace
- [ ] Durable ops use server identity — never localStorage booleans
- [ ] Tests for restore, URL precedence, workspace isolation, version mismatch
- [ ] Intelligence components that add eval/runners document **STATE RESTORATION BEHAVIOR** in the registry docs
