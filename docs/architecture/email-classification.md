# Email classification

Canonical document for mailbox category, business subtype, and authority.

**Classification is not Job assignment.** Inbox Job membership is `EmailMessage.jobId`. See [job-matching.md](job-matching.md).

## Two layers

| Layer | Storage | Inbox use |
|-------|---------|-----------|
| Mailbox category | `EmailMessage.mailboxCategory` (`BUSINESS` \| `PERSONAL` \| `SPAM` \| `TRASH`) | Business / Personal / Trash tabs |
| Business subtype | `Classification.businessTypeKey` | Quote chip, subtype dropdown, badges |
| Legacy twin | `Classification.businessCategory` (`BUSINESS` \| `NON_BUSINESS`) | Mapped 1:1 with PERSONAL ↔ NON_BUSINESS; list filters use `mailboxCategory` |

Native classify decides `BUSINESS` vs `PERSONAL` via cumulative flags (`packages/shared/src/reference/flags-cumulative-classifier.ts`) plus OpenAI signals.

## Subtypes

Canonical keys: `packages/shared/src/business-subtypes.ts`.

User-facing labels that matter operationally:

| Key | Badge label | Typical direction |
|-----|-------------|-------------------|
| `GENERAL` | General | both |
| `BID_OPPORTUNITY` | Bid Opportunity | incoming |
| `ESTIMATE_QUOTE` | Quote | sent |

There are additional keys (`BID_UPDATE`, `PURCHASE_ORDER_CONTRACT`, … `OTHER_BUSINESS`).

**Bid Opportunity subtype ≠ Active Bid membership.** The Inbox **Active Bid** chip filters `BidCandidateEmail` links to Candidates in `OPEN` \| `QUOTED`, not `businessTypeKey`. See [product/inbox.md](../product/inbox.md).

## Authority (verified in code)

`packages/shared/src/classification-authority.ts`:

```
USER_EXPLICIT (3) > SYSTEM_DETERMINISTIC (2) > AI (1)
```

`canReplaceClassificationAuthority` allows replace when incoming rank **≥** existing (same-level refresh allowed).

Resolution fallback if `routingHints.authority` is missing:

- `deterministic === true` or source in `{bid_invites_folder, quotes_folder}` → `SYSTEM_DETERMINISTIC`
- else `reviewedByUserId` set → `USER_EXPLICIT`
- else `AI`

### Who writes which authority

| Authority | Writers |
|-----------|---------|
| `USER_EXPLICIT` | Manual reclassify; ForgeOps compose (`forgeops_compose`) |
| `SYSTEM_DETERMINISTIC` | Bid Invites folder → `BID_OPPORTUNITY`; Quotes folder → `ESTIMATE_QUOTE` |
| `AI` | Native `mailbox-classify` pipeline |

Folder subtype writers **refuse** to replace `USER_EXPLICIT`. They still stamp durable folder provenance on the message (`discoveredInBidInvitesFolder`).

**Verified:** authority currently gates **subtype** replacement. Incoming AI may still refresh mailbox category, priority, summary, and entities when subtype is preserved.

## Native pipeline vs legacy analysis

| Path | Queue | LLM? |
|------|-------|------|
| Native classify | `mailbox-classify` | Yes (OpenAI) |
| Legacy inbox analysis | `inbox-analysis` | No (keyword/heuristic) |
| Placeholder `OpenAIInboxClassifier` | none | Returns stub data; not the live path |

Native persist creates `Classification` with `jobId: null`, then may compute Job matcher candidates. Matcher results are **not** written to `EmailMessage.jobId` unless auto-assign is on.

## Unclassified mail

A message with no `Classification` row is **hidden** from Business/Personal Inbox tabs (those queries require `classifications: { some: {} }`). The Unclassified tab exists in code but the UI maps it to Business. Server still supports `unclassifiedOnly` for operators/tools.
