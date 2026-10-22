import { Router } from 'express';
import { getMyHospitalHandler } from '../controllers/hospital.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.get('/me', requireAuth, getMyHospitalHandler);

export default router;
