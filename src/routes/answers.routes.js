import { Router } from 'express';
import { askAnswer } from '../controllers/answers.controller.js';

const router = Router();

router.post('/answers/ask', askAnswer);

export default router;
