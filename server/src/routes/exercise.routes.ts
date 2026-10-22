import { Router } from 'express';
import { generateExerciseDemoVideoHandler } from '../controllers/exercise.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

router.post('/demo-video', requireAuth, uploadRateLimiter, generateExerciseDemoVideoHandler);

export default router;
