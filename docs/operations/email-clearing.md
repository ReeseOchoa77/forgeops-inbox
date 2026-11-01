# Clear / delete semantics

Canonical operational document for destructive Inbox actions.

**Related code:** `apps/api/src/application/services/clear-inbox.ts`, `clear-bidding-analysis.ts`, `trash-email-with-provider-delete.ts`.

## Outlook / Gmail safety (verified in code)

Bulk ForgeOps clearing **removes ForgeOps-side records only**.

`clearConnectionInbox` / `deleteScopedEmailMessages`:

- Do **not** import or call Microsoft Graph
- Do **not** call Gmail delete APIs
- Do **not** honor `InboxConnection.deleteFromProviderOnDelete`

That setting is **Inbox UI trash only** (`trash-email-with-provider-delete.ts`).

**Bulk Clear Inbox and Clear All Emails cannot delete the corresponding actual Outlook (or Gmail) mailbox messages.**

## Operations

### 1. Clear Analysis

Mailbox bidding-folder **scan artifacts** only (`clearBiddingAnalysisStaging`).

Deletes:

- `BidFolderDiscoveryEmail` (scan index)
- `BidAnalysisRun`
- ephemeral `BidQuoteStaging` (`isDurable: false`, unlinked, not user-confirmed)

Never deletes:

- `BidCandidate`
- `BidCandidateEmail`
- durable quotes
- `EmailMessage` / attachments
- Jobs / Customers
- user edits on Candidates

### 2. Clear Inbox (unassigned / non-job)

Mode `NON_JOB_ONLY`: deletes `EmailMessage` rows for that mailbox where `jobId IS NULL`.

Preserves Job-linked emails. Does not delete Jobs, Customers, DiscoveredFolder rows, or BidCandidates.

### 3. Clear Inbox — historical import only

Mode `HISTORICAL_IMPORT_ONLY`: deletes mailbox emails with `fromProjectFolder: false` (Import Previous Emails + regular inbox sync). Project-folder analysis rows stay.

### 4. Clear All Emails

Mode `ALL_EMAILS`: deletes **every** `EmailMessage` for that mailbox (including Job-linked).

Still ForgeOps-side only. Still does not delete Jobs or Customers.

### 5. Include Bid Candidates

Optional flag on **Clear All Emails only**. Default **false** (omit/false preserves Candidates). Other clear modes ignore the flag.

When **checked** (`includeBidCandidates === true` and mode `ALL_EMAILS`):

- Deletes **all** `BidCandidate` rows in the **workspace** (not just this mailbox)
- Regardless of Quote status, lifecycle (including CONVERTED / LOST / ARCHIVED), manual edits, customer, or quote revisions
- Deletes Candidate-linked `BidQuoteStaging`
- `BidCandidateEmail` cascades from Candidate delete
- **Canonical Jobs survive** (`canonicalJobId` is SetNull on the Job relation, Jobs are not deleted)
- **Customers survive**

Converted Candidates are deleted if the box is checked; their Jobs remain.

Candidate-owned blobs do not exist (no Bid document schema). Shared Job documents are not Candidate-owned and are not swept by this flag.

### 6. Explicit individual email delete / trash

Inbox UI trash. If `deleteFromProviderOnDelete` is **true** on that connection, ForgeOps also deletes/moves the provider message (Outlook Deleted Items / Gmail trash as implemented). Default of the setting is **OFF**.

This is the only supported path that may delete provider mail, and only when explicitly enabled per mailbox.

### 7. Provider-side deletion otherwise

There is no bulk Graph delete in Clear Inbox / Clear All. Do not add one without an explicit product decision.

## What email delete cascades vs SetNull

Inside `deleteScopedEmailMessages` (Clear Inbox transaction):

1. `Task.deleteMany` where `sourceMessage` matches (Classification/Task FKs are SetNull — explicit delete avoids orphans)
2. `Classification.deleteMany` for those messages
3. `EmailMessage.deleteMany` — cascades `EmailAttachment`, `NormalizedEmail`, `BidCandidateEmail`, `BidQuoteStaging`, `BidFolderDiscoveryEmail`
4. `EmailThread.deleteMany` only when no messages remain

`JobEmailContact.firstEmailMessageId` SetNull; the contact row stays.

## Clear Inbox transaction

Interactive transaction timeout: **60 seconds** (`CLEAR_INBOX_TRANSACTION_TIMEOUT_MS`). Prisma’s default 5s is too short for production mailboxes.

Order: optional workspace Candidate delete → count job-associated emails → scoped message delete → update connection:

- `inboxClearedAt = clearedAt`
- `syncCursor = null` (Inbox delta must not resurrect live inbox mail)

`sentSyncCursor` is **not** reset in this update. Live Sent import still honors `inboxClearedAt` via `importProviderMailbox` (provider timestamp ≤ watermark is skipped). Historical import may bypass the watermark by design.

## Watermark vs historical import

After any live-inbox-clearing mode, `inboxClearedAt` moves. Live sync must not re-import provider messages at/before that instant. Project-folder analyze and historical import can bypass when explicitly coded to do so.
