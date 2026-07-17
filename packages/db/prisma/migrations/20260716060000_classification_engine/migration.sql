-- Classification: add engine fields
ALTER TABLE "Classification" ADD COLUMN "mailboxCategory" "MailboxCategory";
ALTER TABLE "Classification" ADD COLUMN "mailboxConfidence" DECIMAL(5,4);
ALTER TABLE "Classification" ADD COLUMN "businessTypeKey" TEXT;
ALTER TABLE "Classification" ADD COLUMN "businessTypeConfidence" DECIMAL(5,4);
ALTER TABLE "Classification" ADD COLUMN "entityMatchConfidence" DECIMAL(5,4);
ALTER TABLE "Classification" ADD COLUMN "matchEvidence" JSONB;
ALTER TABLE "Classification" ADD COLUMN "rawAiPayload" JSONB;
ALTER TABLE "Classification" ADD COLUMN "candidateIds" JSONB;
ALTER TABLE "Classification" ADD COLUMN "classifierVersion" TEXT;
ALTER TABLE "Classification" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "Classification" ADD COLUMN "processedAt" TIMESTAMP(3);

-- Backfill mailboxCategory from businessCategory
UPDATE "Classification" SET "mailboxCategory" = 'BUSINESS' WHERE "businessCategory" = 'BUSINESS';
UPDATE "Classification" SET "mailboxCategory" = 'PERSONAL' WHERE "businessCategory" = 'NON_BUSINESS';

CREATE INDEX "Classification_businessTypeKey_idx" ON "Classification"("workspaceId", "businessTypeKey");
CREATE INDEX "Classification_mailboxCategory_idx" ON "Classification"("workspaceId", "mailboxCategory");

-- BusinessType
CREATE TABLE "BusinessType" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "systemKey" TEXT NOT NULL,
  "displayLabel" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessType_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BusinessType" ADD CONSTRAINT "BusinessType_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "BusinessType_workspaceId_systemKey_key" ON "BusinessType"("workspaceId", "systemKey");
CREATE INDEX "BusinessType_systemKey_idx" ON "BusinessType"("systemKey");
CREATE INDEX "BusinessType_active_idx" ON "BusinessType"("workspaceId", "active");

-- Seed system business types (workspaceId = NULL for global defaults)
INSERT INTO "BusinessType" ("id", "workspaceId", "systemKey", "displayLabel", "description", "active", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, NULL, 'BID_INVITATION', 'Bid Invitation', 'Invitation to bid on a project', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'RFQ', 'Request for Quote', 'Request for pricing/quote', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'ADDENDUM', 'Addendum', 'Project addendum or revision', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'PURCHASE_ORDER', 'Purchase Order', 'Purchase order for materials or services', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'VENDOR_QUOTE', 'Vendor Quote', 'Quote from a vendor', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'SUBMITTAL', 'Submittal', 'Project submittal document', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'SHOP_DRAWING', 'Shop Drawing', 'Shop drawing for fabrication', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'RFI', 'RFI', 'Request for information', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'CHANGE_ORDER', 'Change Order', 'Project change order', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'DELIVERY', 'Delivery', 'Delivery notification or scheduling', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'MATERIAL_ORDER', 'Material Order', 'Material order or procurement', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'INVOICE', 'Invoice', 'Invoice or billing', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'PAYMENT', 'Payment', 'Payment notification or remittance', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'PROJECT_COMMUNICATION', 'Project Communication', 'General project communication', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'FIELD_ISSUE', 'Field Issue', 'Field issue or problem report', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'COMPLIANCE', 'Compliance', 'Compliance, safety, or regulatory', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'INTERNAL_ADMIN', 'Internal Admin', 'Internal administrative communication', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'RECRUITING', 'Recruiting', 'Recruiting and hiring', true, now(), now()),
  (gen_random_uuid()::text, NULL, 'OTHER_BUSINESS', 'Other Business', 'Other business communication', true, now(), now());

-- ClassificationCorrection
CREATE TABLE "ClassificationCorrection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "classificationId" TEXT NOT NULL,
  "originalMailboxCategory" TEXT,
  "correctedMailboxCategory" TEXT,
  "originalBusinessType" TEXT,
  "correctedBusinessType" TEXT,
  "originalCustomerId" TEXT,
  "correctedCustomerId" TEXT,
  "originalVendorId" TEXT,
  "correctedVendorId" TEXT,
  "originalJobId" TEXT,
  "correctedJobId" TEXT,
  "originalPriority" TEXT,
  "correctedPriority" TEXT,
  "originalTaskData" JSONB,
  "correctedTaskData" JSONB,
  "reason" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassificationCorrection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ClassificationCorrection" ADD CONSTRAINT "ClassificationCorrection_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ClassificationCorrection" ADD CONSTRAINT "ClassificationCorrection_classificationId_fkey"
  FOREIGN KEY ("classificationId") REFERENCES "Classification"("id") ON DELETE CASCADE;
ALTER TABLE "ClassificationCorrection" ADD CONSTRAINT "ClassificationCorrection_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE INDEX "ClassificationCorrection_classification_idx" ON "ClassificationCorrection"("workspaceId", "classificationId");
CREATE INDEX "ClassificationCorrection_reviewedAt_idx" ON "ClassificationCorrection"("workspaceId", "reviewedAt");

-- ClassificationInstruction
CREATE TABLE "ClassificationInstruction" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassificationInstruction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ClassificationInstruction" ADD CONSTRAINT "ClassificationInstruction_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ClassificationInstruction" ADD CONSTRAINT "ClassificationInstruction_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE INDEX "ClassificationInstruction_active_idx" ON "ClassificationInstruction"("workspaceId", "active");
