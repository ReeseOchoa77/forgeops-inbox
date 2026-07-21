-- BusinessType: add displayGroup and displayOrder
ALTER TABLE "BusinessType" ADD COLUMN "displayGroup" TEXT;
ALTER TABLE "BusinessType" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "BusinessType_displayGroup_idx" ON "BusinessType"("displayGroup", "displayOrder");

-- Clear old system types and seed v1 taxonomy
DELETE FROM "BusinessType" WHERE "workspaceId" IS NULL;

INSERT INTO "BusinessType" ("id", "workspaceId", "systemKey", "displayLabel", "description", "displayGroup", "displayOrder", "active", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, NULL, 'BID_OPPORTUNITY', 'Bid Opportunity', 'Invitation or opportunity to bid on a project', 'BIDS_ESTIMATING', 1, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'BID_UPDATE', 'Bid Update / Addendum', 'Update or addendum to an existing bid', 'BIDS_ESTIMATING', 2, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'ESTIMATE_QUOTE', 'Estimate / Quote', 'Estimate or quote for work or materials', 'BIDS_ESTIMATING', 3, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'PURCHASE_ORDER_CONTRACT', 'Purchase Order / Contract', 'Purchase order or contract document', 'PURCHASING', 1, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'PROJECT_COORDINATION', 'Project Coordination', 'General project coordination and communication', 'PROJECTS', 1, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'RFI_CLARIFICATION', 'RFI / Clarification', 'Request for information or clarification', 'PROJECTS', 2, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'SUBMITTAL_SHOP_DRAWING', 'Submittal / Shop Drawing', 'Submittal or shop drawing for review', 'PROJECTS', 3, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'CHANGE_ORDER_SCOPE', 'Change Order / Scope Change', 'Change order or scope modification', 'PROJECTS', 4, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'FABRICATION_PRODUCTION', 'Fabrication / Production', 'Fabrication or production related', 'PROJECTS', 5, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'MATERIAL_PURCHASING', 'Material / Vendor / Purchasing', 'Material orders and vendor communication', 'PURCHASING', 2, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'DELIVERY_LOGISTICS', 'Delivery / Logistics', 'Delivery scheduling and logistics', 'PROJECTS', 6, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'FIELD_INSTALLATION', 'Field Issue / Installation', 'Field issues and installation coordination', 'PROJECTS', 7, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'INVOICE_PAYMENT', 'Invoice / Payment', 'Invoice or payment related', 'ACCOUNTING', 1, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'COMPLIANCE_LEGAL', 'Compliance / Safety / Legal', 'Compliance, safety, or legal matters', 'INTERNAL', 1, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'INTERNAL_ADMIN', 'Internal Administration', 'Internal administrative communication', 'INTERNAL', 2, true, now(), now()),
  (gen_random_uuid()::text, NULL, 'OTHER_BUSINESS', 'Other Business', 'Other business communication', 'OTHER', 1, true, now(), now());
