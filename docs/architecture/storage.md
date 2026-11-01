# Object storage

Canonical document for attachments and files.

Implementation: `S3AttachmentStorage` in API and worker. Requires `S3_BUCKET` + access key + secret. Optional `S3_ENDPOINT` (path-style). Local: use a **dev** bucket or leave unset. Never point local env at the production bucket.

## What is stored where

| Kind | Key prefix | Status |
|------|------------|--------|
| Email attachments | `attachments/{workspaceId}/{emailMessageId}/{attachmentId}/{filename}` | **IMPLEMENTED** |
| Job binary files | `job-files/{workspaceId}/{jobId}/{fileId}/{filename}` | **IMPLEMENTED** (falls back to local disk if S3 unset) |
| Knowledge documents | `knowledge/{workspaceId}/{docId}/{filename}` | **IMPLEMENTED** |
| `JobDocumentRecord` | metadata linking `JobFile` / `EmailAttachment` — **no** `storageKey` | **IMPLEMENTED** |
| Direct Active Bid uploads | — | **NOT IMPLEMENTED** |

Bid-folder analyze **reads existing** attachment objects by `storageKey`. It does not create a Candidate-owned blob store.

## Email attachments

`EmailAttachment`: provider id, filename, mime, size, `storageKey`, checksum, inline flag, text extract fields.

Unique: `(workspaceId, emailMessageId, providerAttachmentId)` and `(workspaceId, storageKey)`.

Ingest queue: `attachment-ingest`. Text extract is bounded plain text from text-based PDF/DOCX (not OCR).

## Clear / delete vs S3

Bulk Clear Inbox / Clear All Emails delete ForgeOps `EmailMessage` rows (cascading `EmailAttachment` rows). They do **not** call Microsoft Graph. Whether orphaned S3 objects are swept is not the bulk-clear contract — do not document a production GC job unless one is added.

Individual UI trash may delete the provider message when `deleteFromProviderOnDelete` is enabled. See [email-clearing.md](../operations/email-clearing.md).
