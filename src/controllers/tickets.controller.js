import { z } from 'zod';
import { listTickets, getTicketById, updateTicket, createTicket } from '../repositories/zendesk.repository.js';
import { planTriage, finalizeTriage } from '../services/triage.service.js';
import { ensureDbFileId } from '../services/db_file.service.js';

// GET /api/tickets
export async function getTickets(req, res) {
  try {
    const limit = Number(req.query.limit ?? 25);
    const status = String(req.query.status ?? 'open'); // Gets the tickets that have the open status
    const tickets = await listTickets({ limit, status });

    res.json(tickets.map(t => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      has_ai_triaged: (t.tags || []).includes('ai_triaged'),
      tags: t.tags ?? []
    })));
  } catch (e) {
    res.status(500).json({ error: e?.message || 'failed to fetch tickets' });
  }
}

//Triages one ticket by its ID
export async function triageOne(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid ticket id' });

    // check if ?force=1 is passed to re-triage even if already triaged
    const force = String(req.query.force || '').toLowerCase();
    const forceTriage = force === '1' || force === 'true';

    // fetch ticket
    let ticket;
    try {
      ticket = await getTicketById(id);
    } catch (e) {
      return res.status(e?.status || 404).json({ error: e?.message || 'ticket not found' });
    }
    // checks if ticket should be triaged again
    const alreadyTriaged = (ticket.tags || []).includes('ai_triaged');
    if (alreadyTriaged && !forceTriage) {
      return res.status(409).json({ error: 'ticket already triaged, pass ?force=1 to override' });
    }

    // step 1: plan
    const plan = await planTriage({ ticket });

    // step 2: if needed, load DB and pass it in
    let dbFileId = null;
    if (plan.need_db === 'yes') {
      dbFileId = await ensureDbFileId();
    }

    // step 3: finalize triage
    const triaged = await finalizeTriage({ ticket, fileId: dbFileId });

    // update in Zendesk
    const mergedTags = Array.from(new Set([...(ticket.tags || []), 'ai_triaged', `cat_${triaged.category}`, ...triaged.tags]));
    await updateTicket(ticket.id, {
      tags: mergedTags,
      priority: triaged.priority,
      comment: {
        public: false,
        body:
          `AI triage summary:
          Category: ${triaged.category}
          Priority: ${triaged.priority}
          Language: ${triaged.language}
          Confidence: ${Math.round(triaged.confidence * 100)}%
          Used DB: ${plan.need_db === 'yes' ? 'yes' : 'no'}
          Tags: ${(triaged.tags || []).join(', ')}

          Summary:
          ${triaged.summary}
        `
      }
    });

    return res.json({
      id: ticket.id,
      status: 'updated',
      need_db: plan.need_db,
      category: triaged.category,
      priority: triaged.priority
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'single triage failed' });
  }
}

export async function createTicketController(req, res) {
  // validate request body with zod
  const Schema = z.object({
    subject: z.string().min(1).optional(),
    comment: z.object({
      body: z.string().min(1),
      public: z.boolean().optional()  // default is true in Zendesk UI
    }),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    tags: z.array(z.string()).optional(),
    requester: z.object({
      name: z.string(),
      email: z.string().email()
    }).optional(),
  }).strict();

  try {
    const ticket = Schema.parse(req.body);
    const created = await createTicket(ticket);
    // return a compact view
    return res.status(201).json({
      id: created.id,
      subject: created.subject,
      status: created.status,
      url: created.url
    });
  } catch (e) {
    if (e?.name === 'ZodError') {
      return res.status(400).json({ error: 'invalid ticket payload', issues: e.issues });
    }
    // repository already maps common HTTP errors
    return res.status(e?.status || 502).json({ error: e?.message || 'error creating ticket' });
  }
}
