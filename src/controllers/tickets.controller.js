import { listTickets, updateTicket } from '../repositories/zendesk.repository.js';
import { triageTicket } from '../services/triage.service.js';

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

    // fetch new tickets that are not yet triaged
    const allNew = await listTickets({ limit, status: 'open' });
    const candidates = allNew.filter(t => !(t.tags || []).includes('ai_triaged'));

    const results = [];
    for (const t of candidates) {
      try {
        const triaged = await triageTicket(t);

        // merge tags so we do not drop existing ones
        const mergedTags = Array.from(
          new Set([...(t.tags || []), 'ai_triaged', `cat_${triaged.category}`, ...triaged.tags])
        );

        await updateTicket(t.id, {
          tags: mergedTags,
          priority: triaged.priority,
          comment: {
            public: false,
            body: `AI triage summary:
Category: ${triaged.category}
Priority: ${triaged.priority}
Language: ${triaged.language}
Confidence: ${Math.round(triaged.confidence * 100)}%

Summary:
${triaged.summary}
`
          }
        });

        results.push({ id: t.id, status: 'updated' });
        await new Promise(r => setTimeout(r, 300)); // light pacing
      } catch (err) {
        results.push({ id: t.id, status: 'error', detail: err?.message || 'unknown error' });
      }
    }

    res.json({ processed: candidates.length, results });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'triage failed' });
  }
}
