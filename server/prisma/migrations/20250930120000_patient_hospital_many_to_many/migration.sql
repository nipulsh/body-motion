-- CreateTable
CREATE TABLE "hospital_patients" (
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_patients_pkey" PRIMARY KEY ("hospitalId","patientId")
);

-- AlterTable: expand patients and remove user ownership column
ALTER TABLE "patients" ADD COLUMN "firstName" TEXT;
ALTER TABLE "patients" ADD COLUMN "lastName" TEXT;
ALTER TABLE "patients" ADD COLUMN "dateOfBirth" DATE;
ALTER TABLE "patients" ADD COLUMN "gender" TEXT;
ALTER TABLE "patients" ADD COLUMN "phone" TEXT;
ALTER TABLE "patients" ADD COLUMN "email" TEXT;
ALTER TABLE "patients" ADD COLUMN "deformities" TEXT;
ALTER TABLE "patients" ADD COLUMN "chronicConditions" TEXT;
ALTER TABLE "patients" ADD COLUMN "notes" TEXT;

-- Backfill names from legacy single `name` column when present
UPDATE "patients"
SET
  "firstName" = COALESCE(NULLIF(TRIM("name"), ''), 'Unknown'),
  "lastName" = COALESCE("lastName", '')
WHERE "firstName" IS NULL;

UPDATE "patients"
SET "firstName" = 'Unknown', "lastName" = ''
WHERE "firstName" IS NULL;

-- Link existing patients to their user's hospital when available
INSERT INTO "hospital_patients" ("hospitalId", "patientId", "createdAt")
SELECT u."hospitalId", p."id", p."createdAt"
FROM "patients" p
INNER JOIN "users" u ON p."userId" = u."id"
WHERE u."hospitalId" IS NOT NULL
ON CONFLICT ("hospitalId", "patientId") DO NOTHING;

-- Drop legacy ownership column
ALTER TABLE "patients" DROP CONSTRAINT IF EXISTS "patients_userId_fkey";
DROP INDEX IF EXISTS "patients_userId_idx";
ALTER TABLE "patients" DROP COLUMN IF EXISTS "userId";
ALTER TABLE "patients" DROP COLUMN IF EXISTS "name";

ALTER TABLE "patients" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "patients" ALTER COLUMN "lastName" SET NOT NULL;

-- CreateIndex
CREATE INDEX "patients_lastName_firstName_idx" ON "patients"("lastName", "firstName");
CREATE INDEX "hospital_patients_patientId_idx" ON "hospital_patients"("patientId");

-- AddForeignKey
ALTER TABLE "hospital_patients" ADD CONSTRAINT "hospital_patients_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hospital_patients" ADD CONSTRAINT "hospital_patients_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
