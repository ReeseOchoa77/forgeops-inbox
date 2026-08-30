-- Opaque provider page cursor for resumable Since-date historical imports.
-- Do not copy this into AuditEvent metadata (Graph nextLinks can be huge).
ALTER TABLE "MailboxHistoricalImport" ADD COLUMN IF NOT EXISTS "resumeCursor" TEXT;
