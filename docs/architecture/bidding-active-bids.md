# Active Bids / BidCandidate

Canonical document for bidding. Product copy: [`../product/active-bids.md`](../product/active-bids.md).

## Terminology

| Surface | Name |
|---------|------|
| User-facing nav / Inbox chip | **Active Bids** |
| User-facing entity | **Bid** / **Bid Candidate** |
| Email subtype badge | **Bid Opportunity** (`BID_OPPORTUNITY`) |
| Quote subtype badge | **Quote** (`ESTIMATE_QUOTE`) |
| Domain model | `BidCandidate`, `BidCandidateEmail`, `BidQuoteStaging` |

Do not rename Prisma models to “ActiveBid”. Do not call `Job.status = BIDDING` the current Bid workflow — converted Jobs are created as `ACTIVE`.

## Permanence

`BidCandidate` is a **permanent operational entity** (opportunity before Job). Schema: “Permanent operational Bid Candidate.”

- Owned by `workspaceId` (not by mailbox). Mailbox links are provenance.
- Unique `(workspaceId, identityKey)`.
- Clear Analysis **never** deletes Candidates.
- Clear Inbox / Clear All preserves Candidates unless **Include Bid Candidates** is checked (Clear All Emails only).

## Lifecycles and analysis status

Business lifecycle `BidCandidateLifecycle`:

`OPEN` | `QUOTED` | `CONVERTED` | `LOST` | `ARCHIVED`

Analysis status `BidCandidateStatus` (separate):

`DISCOVERED` | `READY` | `NEEDS_REVIEW` | `CONFIRMED` | `REJECTED`

Default Active Bids list and Inbox Active Bid chip: lifecycle **`OPEN` | `QUOTED` only**.

## Fields that matter

| Concern | Storage |
|---------|---------|
| Customer | `customerId` (resolved) + `proposedCustomerName` |
| Anticipated start | `anticipatedStartAt` (independent of `proposedBidDueAt`) |
| Scope | `proposedScope` + `proposedScopeDetail` (independent of Quote scope) |
| Notes | `proposedNotes` (convert copies to `Job.notes`) |
| Emails | `BidCandidateEmail` roles `BID_INVITE` \| `QUOTE` \| `SUPPORTING` \| `ADDENDUM` |
| Quotes | `BidQuoteStaging` (`extractedAmount`, scope, `isDurable`, `matchStatus`) |
| Canonical Job | `canonicalJobId` (set on convert, `onDelete: SetNull`) |
| External / GC number | `proposedJobNumber` — **not** a ForgeOps Job number; convert maps it to `Job.externalRef` |

Direct Candidate-owned documents: **NOT IMPLEMENTED** (no `BidCandidateDocument`). The UI lists linked-email attachments only.

## Bid Invites / Quotes folders

Outlook `Projects/Bid Invites/` and `Projects/Quotes/`.

```text
Bid Invites
  → canonical EmailMessage
  → SYSTEM_DETERMINISTIC BID_OPPORTUNITY
  → BidFolderDiscoveryEmail
  → ensureBidInviteCandidates (including zero-Quote invites → OPEN Candidates)

Quotes
  → canonical EmailMessage
  → SYSTEM_DETERMINISTIC ESTIMATE_QUOTE
  → BidQuoteStaging (may be UNMATCHED)
  → match to Candidates when possible
```

Unmatched emails **remain** as `EmailMessage`. Clear Analysis deletes the discovery index and ephemeral unmatched staging, not the email.

`EmailMessage.discoveredInBidInvitesFolder` is durable provenance. It is **not** the Inbox Active Bid predicate.

## Quote evidence vs quote price

| | |
|---|---|
| Quote **evidence** | Durable `BidQuoteStaging` and/or `BidCandidateEmail.role = QUOTE`. Drives With Quote / Without Quote. |
| Quote **price** | Finite `extractedAmount`. |

Lifecycle may move `OPEN → QUOTED` when a durable Quote is linked **even without an amount**.

**UI invariant (verified):** only a valid finite quote amount produces green quoted treatment / passive Quoted tag (`hasQuotedPrice` / `isValidQuoteAmount`). Evidence without a price must not look priced.

Inbox Sent **Quote** filter: `ESTIMATE_QUOTE` **or** `BidCandidateEmail.role = QUOTE`.

## Inbox Active Bid vs classification

Predicate (`apps/api/src/application/services/active-bid-candidate-membership.ts`):

Email has a `BidCandidateEmail` whose Candidate is in the same workspace with `lifecycle IN (OPEN, QUOTED)`.

Not: `BID_OPPORTUNITY` subtype. Not: `discoveredInBidInvitesFolder`.

CONVERTED / LOST / ARCHIVED Candidates drop out of the chip and the default list. Unlinking the last OPEN/QUOTED membership drops the email from the filter.

The Inbox chip still sends `businessTypeKey=BID_OPPORTUNITY`; the server special-cases that key to the membership predicate.

## Convert to Job

Service: `apps/api/src/application/services/convert-bid-candidate-to-job.ts`.  
Route: `POST /workspaces/:workspaceId/bid-candidates/:id/convert-to-job`.

This **creates a canonical Job**. It is not “flip lifecycle to CONVERTED.”

| Step | Behavior |
|------|----------|
| Transaction | `SELECT … FOR UPDATE`; claim `lifecycle IN (OPEN, QUOTED)` and `canonicalJobId: null` |
| Convertible | OPEN/QUOTED only; analysis REJECTED blocked; LOST/ARCHIVED → `NOT_CONVERTIBLE` |
| Job | `status: ACTIVE`, number from user input (required). `proposedJobNumber` → `Job.externalRef` |
| Scope / notes / dates | Copied onto the Job |
| Emails | All Candidate email links associated (`EmailMessage.jobId`); protected assignments are not stolen |
| Quotes | Staging rows **stay on the Candidate**; quote **emails** transfer with the email set |
| Candidate | Remains. `lifecycle: CONVERTED`, `canonicalJobId` set, `status: CONFIRMED`. Idempotent if already converted |
| PATCH | Cannot set `CONVERTED` via ordinary update |

Converted Candidate historical records remain accessible (not the default Active Bids list).

## Clear semantics (bidding)

See [email-clearing.md](../operations/email-clearing.md).

- Clear Analysis: scan artifacts only; Candidates, durable quotes, emails, Jobs stay.
- Include Bid Candidates (Clear All Emails, default **false**): deletes **all** workspace Candidates regardless of quote/lifecycle/edits. Jobs and Customers survive. Quote staging linked to those Candidates is deleted. `canonicalJobId` SetNull does not delete Jobs.
