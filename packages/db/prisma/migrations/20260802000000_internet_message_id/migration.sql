ALTER TABLE "EmailMessage" ADD COLUMN "internetMessageId" TEXT;
CREATE INDEX "EmailMessage_internetMessageId_idx" ON "EmailMessage"("internetMessageId");
