import { Router } from 'express';
import { serveLocalObjectHandler } from '../controllers/storage.controller';

const router = Router();

router.get('/storage/:bucket/*objectPath', serveLocalObjectHandler);

export default router;
