-- Extend ScanStatus lifecycle for pipeline integration
ALTER TYPE "ScanStatus" ADD VALUE IF NOT EXISTS 'UPLOADED';
ALTER TYPE "ScanStatus" ADD VALUE IF NOT EXISTS 'ANALYZING';
ALTER TYPE "ScanStatus" ADD VALUE IF NOT EXISTS 'GENERATING_MODEL';

-- Scans that finished upload (Step 5) but have not completed analysis are ready to process
UPDATE "scans" s
SET "status" = 'UPLOADED'
WHERE s."status" = 'COMPLETED'
  AND NOT EXISTS (
    SELECT 1
    FROM "analysis_jobs" j
    WHERE j."scanId" = s."id"
      AND j."status" = 'COMPLETED'
  );
