import { Router } from 'express';
import {
  getScanAnalysisHandler,
  getScanHandler,
  listScanImagesHandler,
  listScanModelsHandler,
  processScanHandler,
  uploadScanImagesHandler,
  uploadScanModelHandler,
} from '../controllers/scan.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadRateLimiter } from '../middleware/rateLimit.middleware';
import { patientModelUpload, scanImagesUpload } from '../middleware/upload.middleware';

const router = Router();

router.get('/:scanId', requireAuth, getScanHandler);
router.get('/:scanId/analysis', requireAuth, getScanAnalysisHandler);
router.post('/:scanId/process', requireAuth, processScanHandler);
router.post('/:scanId/analyze', requireAuth, processScanHandler);
router.get('/:scanId/images', requireAuth, listScanImagesHandler);
router.get('/:scanId/models', requireAuth, listScanModelsHandler);
router.post(
  '/:scanId/images',
  requireAuth,
  uploadRateLimiter,
  scanImagesUpload,
  uploadScanImagesHandler,
);
router.post(
  '/:scanId/models',
  requireAuth,
  uploadRateLimiter,
  patientModelUpload,
  uploadScanModelHandler,
);

export default router;
