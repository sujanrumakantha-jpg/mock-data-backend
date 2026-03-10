import { Router } from 'express';
import { GenerationController } from './generation.controller';

const router = Router();

// POST /api/generate/start
router.post('/start', GenerationController.startGeneration);

// GET /api/generate/status/:jobId
router.get('/status/:jobId', GenerationController.getJobStatus);

// GET /api/generate/result/:jobId
router.get('/result/:jobId', GenerationController.getJobResult);

export default router;
