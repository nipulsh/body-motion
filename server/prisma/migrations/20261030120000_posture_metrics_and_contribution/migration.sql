-- Idempotent so a database already updated with `prisma db push` (or a re-run) does not fail.
-- Both columns are nullable or defaulted, so the previous release keeps working against the
-- migrated database: migrate first, then deploy the new code (see `npm run start:deploy`).

-- AlterTable
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "postureMetrics" JSONB;

-- AlterTable
ALTER TABLE "muscle_findings" ADD COLUMN IF NOT EXISTS "contributionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
