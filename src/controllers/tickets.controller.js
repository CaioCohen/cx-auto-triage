import { z } from 'zod';
import { listTickets, getTicketById, updateTicket, createTicket } from '../repositories/zendesk.repository.js';
import { planTriage, finalizeTriage } from '../services/triage.service.js';
import { loadDbText } from '../repositories/mockdb.repository.js';

// GET /api/tickets
export async function getTickets(req, res) {
  try {
    const limit = Number(req.query.limit ?? 25);
    const status = String(req.query.status ?? 'open');
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

// POST /api/triage/run
export async function runTriage(req, res) {
  try {
    const limit = Number(req.query.limit ?? 25);
    const allNew = await listTickets({ limit, status: 'open' });
    const candidates = allNew.filter(t => !(t.tags || []).includes('ai_triaged'));

    const results = [];
    for (const t of candidates) {
      try {
        const plan = await planTriage({ ticket: t }); // { need_db, notes? }

        let checksPayload = { context: {}, checks: [] };
        if (plan.need_db === 'yes') {
          checksPayload = await runAutoChecks(t); // { context, checks }
        }

        const triaged = await finalizeTriage({ ticket: t, checks: checksPayload.checks });

        const mergedTags = Array.from(new Set([...(t.tags || []), 'ai_triaged', `cat_${triaged.category}`, ...triaged.tags]));
        await updateTicket(t.id, {
          tags: mergedTags,
          priority: triaged.priority,
          comment: {
            public: false, body:
              `AI triage summary:
              Category: ${triaged.category}
              Priority: ${triaged.priority}
              Root cause: ${triaged.root_cause}
              Need DB: ${plan.need_db}
              Evidence checks: ${checksPayload.checks.length ? 'present' : 'none'}

              Inferred context:
              ${JSON.stringify(checksPayload.context, null, 2)}

              Actions:
              ${(triaged.actions || []).map(a => `- ${a}`).join('\n')}

              Notes:
              ${triaged.comment_private || '(none)'}
              `
          }
        });

        results.push({ id: t.id, status: 'updated', need_db: plan.need_db });
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        results.push({ id: t.id, status: 'error', detail: err?.message || 'unknown error' });
      }
    }

    res.json({ processed: candidates.length, results });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'triage failed' });
  }
}

export async function triageOne(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid ticket id' });

    const force = String(req.query.force || '').toLowerCase();
    const forceTriage = force === '1' || force === 'true';

    // fetch ticket
    let ticket;
    try {
      ticket = await getTicketById(id);
    } catch (e) {
      return res.status(e?.status || 404).json({ error: e?.message || 'ticket not found' });
    }

    const alreadyTriaged = (ticket.tags || []).includes('ai_triaged');
    if (alreadyTriaged && !forceTriage) {
      return res.status(409).json({ error: 'ticket already triaged, pass ?force=1 to override' });
    }

    // step 1: plan
    const plan = await planTriage({ ticket });

    // step 2: if needed, load DB and pass it in
    const dbText = plan.need_db === 'yes' ? await loadDbText() : null;

    // step 3: finalize
    const triaged = await finalizeTriage({ ticket, checks: [], db: dbText });

    // update in Zendesk (same compact comment as above)
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
    requester_id: z.number().int().positive().optional(),
    requester: z.object({
      name: z.string(),
      email: z.string().email()
    }).optional(),
    group_id: z.number().int().positive().optional(),
    assignee_id: z.number().int().positive().optional()
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
