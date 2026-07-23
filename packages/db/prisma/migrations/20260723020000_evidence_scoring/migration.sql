-- WorkspaceSetting: add classification weights and thresholds
ALTER TABLE "WorkspaceSetting" ADD COLUMN "businessThreshold" DECIMAL(5,4) NOT NULL DEFAULT 0.8500;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "personalThreshold" DECIMAL(5,4) NOT NULL DEFAULT 0.2000;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "weightContent" DECIMAL(5,4) NOT NULL DEFAULT 0.4000;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "weightSender" DECIMAL(5,4) NOT NULL DEFAULT 0.2500;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "weightSignature" DECIMAL(5,4) NOT NULL DEFAULT 0.1500;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "weightJob" DECIMAL(5,4) NOT NULL DEFAULT 0.1500;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "weightSubject" DECIMAL(5,4) NOT NULL DEFAULT 0.0500;

-- Classification: add evidence breakdown
ALTER TABLE "Classification" ADD COLUMN "classificationEvidence" JSONB;
