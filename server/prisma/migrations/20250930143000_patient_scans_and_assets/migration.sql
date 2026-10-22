-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('BODY_360');
CREATE TYPE "ScanStatus" AS ENUM ('CREATED', 'UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "PatientModelFormat" AS ENUM ('GLB');

-- CreateTable
CREATE TABLE "scans" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "ScanType" NOT NULL DEFAULT 'BODY_360',
    "status" "ScanStatus" NOT NULL DEFAULT 'CREATED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_models" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "scanId" TEXT,
    "bucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "format" "PatientModelFormat" NOT NULL DEFAULT 'GLB',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_models_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "analysis_jobs" ADD COLUMN "scanId" TEXT;
ALTER TABLE "patient_images" ADD COLUMN "scanId" TEXT;
ALTER TABLE "patient_images" ALTER COLUMN "jobId" DROP NOT NULL;
ALTER TABLE "patient_images" ALTER COLUMN "orderIndex" SET DEFAULT 0;

-- Backfill legacy scan records for existing analysis jobs that already have images
INSERT INTO "scans" ("id", "patientId", "type", "status", "createdAt", "updatedAt")
SELECT
    j."id",
    j."patientId",
    'BODY_360'::"ScanType",
    CASE
        WHEN j."status" = 'FAILED' THEN 'FAILED'::"ScanStatus"
        WHEN j."status" = 'COMPLETED' THEN 'COMPLETED'::"ScanStatus"
        ELSE 'PROCESSING'::"ScanStatus"
    END,
    j."createdAt",
    j."updatedAt"
FROM "analysis_jobs" j
WHERE EXISTS (SELECT 1 FROM "patient_images" pi WHERE pi."jobId" = j."id")
ON CONFLICT ("id") DO NOTHING;

UPDATE "analysis_jobs" j
SET "scanId" = j."id"
WHERE j."scanId" IS NULL
  AND EXISTS (SELECT 1 FROM "scans" s WHERE s."id" = j."id");

UPDATE "patient_images" pi
SET "scanId" = pi."jobId"
WHERE pi."scanId" IS NULL
  AND pi."jobId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "scans" s WHERE s."id" = pi."jobId");

-- CreateIndex
CREATE INDEX "scans_patientId_idx" ON "scans"("patientId");
CREATE INDEX "scans_status_idx" ON "scans"("status");
CREATE INDEX "patient_models_patientId_idx" ON "patient_models"("patientId");
CREATE INDEX "patient_models_scanId_idx" ON "patient_models"("scanId");
CREATE INDEX "analysis_jobs_scanId_idx" ON "analysis_jobs"("scanId");
CREATE INDEX "patient_images_scanId_idx" ON "patient_images"("scanId");

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "patient_images" ADD CONSTRAINT "patient_images_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_models" ADD CONSTRAINT "patient_models_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_models" ADD CONSTRAINT "patient_models_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
