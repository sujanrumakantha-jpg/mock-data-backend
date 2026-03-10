import { Router } from 'express';
import { ExportController } from './export.controller';

const router = Router();

// POST /api/export
router.post('/', ExportController.exportData);

export default router;
