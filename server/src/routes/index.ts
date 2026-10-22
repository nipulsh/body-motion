import { Router } from 'express';
import exerciseRoutes from './exercise.routes';
import healthRoutes from './health.routes';
import hospitalRoutes from './hospital.routes';
import jobRoutes from './job.routes';
import patientRoutes from './patient.routes';
import scanRoutes from './scan.routes';

const router = Router();

router.use(healthRoutes);
router.use('/hospital', hospitalRoutes);
router.use('/patients', patientRoutes);
router.use('/scans', scanRoutes);
router.use('/jobs', jobRoutes);
router.use('/exercises', exerciseRoutes);

export default router;
