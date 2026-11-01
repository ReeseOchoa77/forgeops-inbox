# Inbox (product)

UI implementation: `apps/web/src/views/MessagesView.tsx`. Server filters: `apps/api/src/interfaces/http/routes/inbox-read.route.ts`.

Architecture: [email-ingestion](../architecture/email-ingestion.md), [classification](../architecture/email-classification.md), [job-matching](../architecture/job-matching.md).

## Top filters (normal)

**Business | Sent | Personal | Active Bid | Trash**

| Control | Semantics |
|---------|-----------|
| Business | `mailboxCategory=BUSINESS` and a Classification row exists |
| Sent | **Direction** chip (`sentOnly`), ANDed with other filters — not a tab that replaces classification |
| Personal | `mailboxCategory=PERSONAL`. Hidden unless OWNER/ADMIN (all/others’ mailboxes) or own inbox |
| Active Bid | Only in Business chrome **and not Sent**. Server: `BidCandidateEmail` membership on Candidates `OPEN`\|`QUOTED`. **Not** Bid Opportunity subtype |
| Trash | `isTrashed: true` |

## Sent context

When Sent is on: **Business | Sent | Personal | Quote | Trash**.

- Quote chip: `ESTIMATE_QUOTE` **or** `BidCandidateEmail.role = QUOTE`
- Quote exists **only in Sent**. Leaving Sent clears Quote. Entering Sent clears Active Bid.

## Secondary filters

Unread, Pinned, Jobs, date range, priority, subtype dropdown.

- Unread / Pinned / Jobs / dates / subtype / search: **server-side before pagination**
- **Read** (as opposed to Unread) and **priority** are applied client-side after fetch
- Personal visibility for non-admin on others’ mailboxes is also client-side

Unclassified is **hidden** from the filter bar (Unclassified tab maps to Business). Subtype remains available through the dropdown.

## Active Bid vs Bid Opportunity

An email classified `BID_OPPORTUNITY` is **not** automatically an Active Bid. Membership is `BidCandidateEmail` on an OPEN/QUOTED Candidate. See [bidding-active-bids.md](../architecture/bidding-active-bids.md).

## Smart search

`packages/shared` + Inbox list `search` / participant params.

| Capability | Status |
|------------|--------|
| Free-text content (sender, subject, snippet, body, To/Cc JSON, normalized body) | **IMPLEMENTED** |
| Participant chips (known complete email / highlighted suggestion) | **IMPLEMENTED** |
| Sender suggestions on received/business | **IMPLEMENTED** |
| Recipient suggestions on sent | **IMPLEMENTED** |
| Multiple chips, OR between chips | **IMPLEMENTED** |
| AND between chip set and text | **IMPLEMENTED** |
| Server-side filtering | **IMPLEMENTED** |
| Cache keys include sorted participant emails independently of text | **IMPLEMENTED** |
| Tokenize incomplete names (`stairway`, `Connor`) into chips | **NOT IMPLEMENTED** (stay text) |
| Word-level AND inside the text box | **NOT IMPLEMENTED** (one `contains` on the trimmed string) |
| BCC in unified text search | **NOT IMPLEMENTED** |
| `searchIn=id` exact lookup | **IMPLEMENTED** on API; UI does not send it |

Autocomplete: `GET /workspaces/:id/email-participants/search`, debounce ~350ms, limit 8.
