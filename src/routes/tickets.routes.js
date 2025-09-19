import { Router } from 'express';
import { createTicketController, getTickets, triageOne } from '../controllers/tickets.controller.js';

const router = Router();

// GET
router.get('/tickets', getTickets);

// POST

router.post('/tickets/:id/triage', triageOne);

router.post('/tickets', createTicketController);

export default router;
