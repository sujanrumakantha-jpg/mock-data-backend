import express from 'express';
import { signup, login, getMe } from './auth.controller';
import { protect } from './auth.middleware';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', protect, getMe);

export default router;
