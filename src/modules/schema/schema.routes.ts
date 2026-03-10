import { Router } from 'express';
import { SchemaController } from './schema.controller';
import { protect } from '../auth/auth.middleware';

const router = Router();

// All schema routes are protected
router.use(protect);

// GET /api/schema/history (Must be before :schemaId routes)
router.get('/history', SchemaController.getHistory);

// POST /api/schema/upload
router.post('/upload', SchemaController.uploadSchema);

// POST /api/schema/extract-db
router.post('/extract-db', SchemaController.extractFromDb);

// POST /api/schema/extract
router.post('/extract', SchemaController.extractSchema);

// GET /api/schema/:schemaId/questions
router.get('/:schemaId/questions', SchemaController.getConfigurationQuestions);

export default router;
