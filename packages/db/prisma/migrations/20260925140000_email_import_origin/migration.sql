-- Distinguish project-folder analysis from Import Previous Emails and live inbox sync.
ALTER TABLE "EmailMessage" ADD COLUMN "fromHistoricalImport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailMessage" ADD COLUMN "fromProjectFolder" BOOLEAN NOT NULL DEFAULT false;
