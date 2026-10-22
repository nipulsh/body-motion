import { Router } from 'express';
import { env } from '../config/env';
import { getHealth, testUploadHandler } from '../controllers/health.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { testImageUpload } from '../middleware/upload.middleware';

const router = Router();

router.get('/health', getHealth);

if (!env.isProduction) {
  router.post('/test-upload', requireAuth, testImageUpload, testUploadHandler);
}

export default router;
