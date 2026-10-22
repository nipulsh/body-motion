import { Router } from 'express';
import {
  generateJobExercisesHandler,
  getGeneratedImagesHandler,
  getJobAnalysisHandler,
  getJobModelHandler,
  getJobStatusHandler,
  retryJobHandler,
} from '../controllers/job.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.get('/:jobId', requireAuth, getJobStatusHandler);
router.get('/:jobId/analysis', requireAuth, getJobAnalysisHandler);
router.post('/:jobId/exercises', requireAuth, generateJobExercisesHandler);
router.get('/:jobId/generated-images', requireAuth, getGeneratedImagesHandler);
router.get('/:jobId/model', requireAuth, getJobModelHandler);
router.post('/:jobId/retry', requireAuth, retryJobHandler);

export default router;
