# Customers (product)

Customer is a **canonical workspace-owned business entity**. Jobs and Active Bids (`BidCandidate`) reference it by `customerId`. Do not store free-text customer names as a substitute identity on those records (display names may denormalize for lists; identity is the FK).

## Identity & uniqueness

| Field | Role |
|-------|------|
| `name` | Display name |
| `normalizedName` | Dedup key via `normalizeName` (trim, case-fold, strip common company suffixes) |
| `primaryEmail` / `domain` / `phone` / `externalRef` / `notes` | Optional metadata |

**Uniqueness:** `@@unique([workspaceId, normalizedName])`. Creating "Mortenson" and "  mortenson  " reuses one record. Creating "Mortenson Construction" also reuses "Mortenson" because `normalizeName` strips the `construction` suffix — that is intentional existing architecture, not fuzzy merge.

Fuzzy-similar names that normalize differently (e.g. "Ryan Companies" vs "Ryan Builders") remain separate. No AI matching. No automatic fuzzy merge in selectors.

## Select-or-create

Anywhere ForgeOps asks for a Customer (Job create/edit/inline edit, Active Bid create/edit, Bid → Job convert, Company Data create), use the shared **CustomerSelectOrCreate** control:

1. Type to search existing Customers (substring, case-insensitive).
2. Select an existing match.
3. Or explicitly **+ Create "…"** — only then does the client call `POST /reference/customers`.
4. Typing alone never creates records.

Create is idempotent on `normalizedName` (returns existing with `created: false` when collision).

## Customer Data (Company Data → Customers)

- List shows name, email, domain, phone, contact/job/bid counts.
- Search filters by name.
- Click a Customer → detail: overview (editable metadata), Jobs (`Job.customerId`), Active Bids (`BidCandidate.customerId`), contacts (`EntityContact.customerId`).
- Job / Bid rows open canonical Job detail / Active Bid detail.

## APIs

| Method | Path |
|--------|------|
| GET | `/api/v1/workspaces/:workspaceId/reference/customers` (`?includeCounts=true`, `?search=`) |
| POST | `/api/v1/workspaces/:workspaceId/reference/customers` |
| GET | `/api/v1/workspaces/:workspaceId/reference/customers/:customerId` |
| PATCH | `/api/v1/workspaces/:workspaceId/reference/customers/:customerId` |
| DELETE | `/api/v1/workspaces/:workspaceId/reference/customers/:customerId` (existing; use carefully) |

All operations are workspace-scoped and require membership; writes require editor roles (`OWNER` / `ADMIN` / `MANAGER` / `MEMBER`).

## Job & Bid integration

- **Job:** `Job.customerId` (list/create/inline). Job Settings also has separate GC/client Customer FKs (`contractorCustomerId` / `clientCustomerId`) — do not confuse with the primary list Customer.
- **BidCandidate:** `customerId` + optional `proposedCustomerName`. Manual Customer edits are locked in `userEditedFields`.
- **Convert:** `resolveOrCreateBiddingCustomer` reuses `customerId` when set; does not invent a second Customer for the same org.

## Deletion

Customer delete already exists in Company Data. It clears some FKs and deletes aliases/contacts. Prefer not expanding delete semantics without a dedicated audit — Customers often retain Jobs and Bid history.
