import { Router } from 'express';
import {
  createJobHandler,
  createPatientHandler,
  deletePatientHandler,
  getPatientHandler,
  listPatientsHandler,
  updatePatientHandler,
} from '../controllers/patient.controller';
import {
  createScanHandler,
  listPatientAssetImagesHandler,
  listPatientAssetModelsHandler,
  listPatientScansHandler,
} from '../controllers/scan.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadRateLimiter } from '../middleware/rateLimit.middleware';
import { patientImagesUpload } from '../middleware/upload.middleware';

const router = Router();

router.post('/', requireAuth, createPatientHandler);
router.get('/', requireAuth, listPatientsHandler);

router.get('/:patientId/scans', requireAuth, listPatientScansHandler);
router.post('/:patientId/scans', requireAuth, createScanHandler);
router.get('/:patientId/images', requireAuth, listPatientAssetImagesHandler);
router.get('/:patientId/models', requireAuth, listPatientAssetModelsHandler);

router.get('/:patientId', requireAuth, getPatientHandler);
router.patch('/:patientId', requireAuth, updatePatientHandler);
router.delete('/:patientId', requireAuth, deletePatientHandler);

router.post(
  '/:patientId/jobs',
  requireAuth,
  uploadRateLimiter,
  patientImagesUpload,
  createJobHandler,
);

export default router;
