# Workspace State Persistence

**Status:** IMPLEMENTED (client helpers + surface wiring). Long-running Intelligence evaluations remain **sync HTTP** — they do **not** survive refresh via browser storage.

Related: [overview.md](overview.md), [intelligence-registry.md](intelligence-registry.md), [job-matching.md](job-matching.md).

## Goal

Refreshing the browser should restore the user’s working context when doing so is **safe, meaningful, and truthful**.

Do **not** dump the whole app into `localStorage`. Different categories use different mechanisms.

## State categories

| Category | Examples | Persistence |
|----------|----------|-------------|
| 1. Route / navigation | Page, Intelligence component id, detail tab | URL query (`view`, `intel`, `intelTab`) + scoped localStorage backup |
| 2. Shareable filter / query | Inbox category/filters, Jobs filters, eval outcome filter | Prefer URL when compact; otherwise scoped localStorage |
| 3. Workspace UI prefs | Inspector tab, Emails vs Jobs view, density | Scoped localStorage |
| 4. Draft / unsaved input | Job Matcher eval configuration before run | Scoped localStorage (config only) |
| 5. Durable operations | Long evals, worker jobs | **Server run/task identity only** — never faked in localStorage |

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

**Not persisted:** evaluation result rows, email bodies, progress as “still running.”

## Long-running evaluation (Job Matcher)

Current architecture:

```text
POST .../intelligence/job-matcher/evaluate
  → synchronous response (max sample 1000)
  → result lives in React state only
```

There is **no** EvaluationRun / worker job id for Manage → Intelligence evaluation today.

Therefore:

- Refresh **aborts** the in-flight browser request and **clears** on-screen results
- Configuration **does** restore so the user can re-run
- Do **not** store `busy: true` in localStorage and claim a run is active

If durable runs are required later: reuse Worker Jobs / analysis-run patterns already used elsewhere (reclassify, bid analysis, project-folder analyze). **Stop and design** before adding a new `EvaluationRun` table.

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
