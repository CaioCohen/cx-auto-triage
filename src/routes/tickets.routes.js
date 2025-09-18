import { Router } from 'express';
import { getTickets, runTriage } from '../controllers/tickets.controller.js';

const router = Router();

// GET /api/tickets?status=new&limit=25
router.get('/tickets', getTickets);

// POST /api/triage/run?limit=25
router.post('/triage/run', runTriage);

export default router;
