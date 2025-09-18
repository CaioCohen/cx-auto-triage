import { Router } from 'express';
import { createTicketController, getTickets, triageOne } from '../controllers/tickets.controller.js';

const router = Router();

// GET /api/tickets?status=new&limit=25
router.get('/tickets', getTickets);

// POST /api/triage/run?limit=25

router.post('/tickets/:id/triage', triageOne);

router.post('/tickets', createTicketController);

export default router;
