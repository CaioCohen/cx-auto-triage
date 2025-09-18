import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import OpenAI from 'openai';
import { z } from 'zod';

/* ========= env ========= */
const {
  ZENDESK_SUBDOMAIN,
  ZENDESK_EMAIL,
  ZENDESK_API_TOKEN,
  OPENAI_API_KEY,
  PORT = '3000',
} = process.env;

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN || !OPENAI_API_KEY) {
  throw new Error('Missing env vars. Check .env');
}

/* ========= clients ========= */
const ZENDESK_BASE = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const ZENDESK_AUTH = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');

function zendesk() {
  return axios.create({
    baseURL: ZENDESK_BASE,
    headers: { Authorization: `Basic ${ZENDESK_AUTH}` },
    timeout: 15000,
  });
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ========= schemas ========= */
const TriagedSchema = z.object({
  category: z.enum(['billing','bug','how_to','account','feature_request','other']),
  priority: z.enum(['low','normal','high','urgent']),
  language: z.string().min(2).max(8),
  tags: z.array(z.string()).max(10),
  summary: z.string().min(10).max(750),
  confidence: z.number().min(0).max(1)
});

/* ========= core functions ========= */
async function fetchTickets({ limit = 50, status = 'new' }) {
  const res = await zendesk().get('/tickets.json', {
    params: { sort_by: 'created_at', sort_order: 'desc', per_page: Math.min(limit, 100) }
  });
  const tickets = res.data.tickets ?? [];
  return status ? tickets.filter(t => t.status === status) : tickets;
}

async function fetchNewTickets(limit = 50) {
  const tickets = await fetchTickets({ limit, status: 'new' });
  return tickets.filter(t => !(t.tags || []).includes('ai_triaged'));
}

async function triageWithOpenAI(ticket) {
  const userText = `
Subject: ${ticket.subject || '(no subject)'}
Body:
${ticket.description || '(no description)'}
`;

  const systemPrompt = `You are a senior CX triage assistant.
Return a strict JSON object with fields:
- category: one of [billing, bug, how_to, account, feature_request, other]
- priority: one of [low, normal, high, urgent]
- language: ISO code if certain else a short label
- tags: up to 5 short kebab-case tags
- summary: 2 to 5 sentences, concise, for internal note
- confidence: number 0..1`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
    temperature: 0.2
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');

  return TriagedSchema.parse(JSON.parse(content));
}

async function updateTicket(ticket, triaged) {
  // merge tags so we do not drop existing ones
  const mergedTags = Array.from(
    new Set([...(ticket.tags || []), 'ai_triaged', `cat_${triaged.category}`, ...triaged.tags])
  );

  const body = {
    ticket: {
      tags: mergedTags,
      priority: triaged.priority,
      comment: {
        body: `AI triage summary:
Category: ${triaged.category}
Priority: ${triaged.priority}
Language: ${triaged.language}
Confidence: ${Math.round(triaged.confidence * 100)}%

Summary:
${triaged.summary}
`,
        public: false
      }
    }
  };

  await zendesk().put(`/tickets/${ticket.id}.json`, body);
}

async function runTriage(limit = 50) {
  const results = [];
  const tickets = await fetchNewTickets(limit);
  for (const t of tickets) {
    try {
      const triaged = await triageWithOpenAI(t);
      await updateTicket(t, triaged);
      results.push({ id: t.id, status: 'updated' });
      await new Promise(r => setTimeout(r, 300)); // light pacing
    } catch (e) {
      results.push({ id: t.id, status: 'error', detail: e?.message || 'unknown error' });
    }
  }
  return { processed: tickets.length, results };
}

/* ========= express app ========= */
const app = express();
app.use(cors());
app.use(express.json());

// quick sanity endpoints
app.get('/', (_req, res) => res.send('cx-auto-triage up'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /tickets?status=new&limit=25
app.get('/tickets', async (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 25);
    const status = String(req.query.status ?? 'new');
    const tickets = await fetchTickets({ limit, status });
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
});

// POST /triage/run
app.post('/triage/run', async (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 25);
    const result = await runTriage(limit);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'triage failed' });
  }
});

// minimal crash logging
process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION', err);
});
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION', err);
});

// bind on 0.0.0.0 for Windows friendliness
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
