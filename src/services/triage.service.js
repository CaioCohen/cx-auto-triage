// triage.service.js
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import url from 'url';
import { z } from 'zod';

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const KNOWLEDGE_PATH = process.env.KNOWLEDGE_PATH || path.join(__dirname, '../../knowledge/description.txt');

let KNOWLEDGE = '';
async function loadKnowledge() {
  if (!KNOWLEDGE) {
    try { KNOWLEDGE = await fs.readFile(KNOWLEDGE_PATH, 'utf-8'); }
    catch { KNOWLEDGE = 'Knowledge file missing.'; }
  }
  return KNOWLEDGE;
}

/* ----------------- schemas ----------------- */

// Strict schema - allows null for optional extracted fields
const PlanSchemaStrict = z.object({
  need_db: z.enum(['yes', 'no']),
  notes: z.string().optional(),
  email: z.string().email().nullable().optional(),
  org_id: z.string().nullable().optional(),
  project_name: z.string().nullable().optional(),
  dashboard_name: z.string().nullable().optional(),
  widget_title: z.string().nullable().optional(),
  metric_id: z.string().nullable().optional()
}).passthrough();

// Loose schema - never throws on bad optional fields
const PlanSchemaLoose = z.object({
  need_db: z.string().optional(),
  notes: z.any().optional(),
  email: z.any().optional(),
  org_id: z.any().optional(),
  project_name: z.any().optional(),
  dashboard_name: z.any().optional(),
  widget_title: z.any().optional(),
  metric_id: z.any().optional()
}).passthrough();

/* ----------------- sanitizers ----------------- */

function norm(s) { return String(s || '').toLowerCase(); }
function ticketText(ticket) { return `${ticket.subject || ''}\n${ticket.description || ''}`; }
function findEmails(text) {
  return (String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(e => e.toLowerCase());
}
function containsLiteral(text, value) {
  if (!value) return false;
  return norm(text).includes(norm(value));
}

// Always return keys with either a literal value or null
function sanitizePlan(rawPlan, ticket) {
  const text = ticketText(ticket);
  const emails = findEmails(text);

  const need = rawPlan.need_db === 'yes' ? 'yes' : (rawPlan.need_db === 'no' ? 'no' : 'no');

  return {
    need_db: need,
    notes: typeof rawPlan.notes === 'string' ? rawPlan.notes : undefined,

    // email - prefer literal from ticket; if none, null
    email: emails.length > 0 ? emails[0] : null,

    // only keep literal substrings - else null
    org_id: containsLiteral(text, rawPlan.org_id) ? String(rawPlan.org_id) : null,
    project_name: containsLiteral(text, rawPlan.project_name) ? String(rawPlan.project_name) : null,
    dashboard_name: containsLiteral(text, rawPlan.dashboard_name) ? String(rawPlan.dashboard_name) : null,
    widget_title: containsLiteral(text, rawPlan.widget_title) ? String(rawPlan.widget_title) : null,
    metric_id: containsLiteral(text, rawPlan.metric_id) ? String(rawPlan.metric_id) : null
  };
}

/* ----------------- LLM call ----------------- */

export async function planTriage({ ticket }) {
  const knowledge = await loadKnowledge();
  const messages = [
    {
      role: 'system',
      content:
        'You are a triage planner. Decide if DB checks are needed. ' +
        'Reply ONLY with a strict JSON object: ' +
        '{ need_db: "yes"|"no", notes?: string, email?: string, org_id?: string, project_name?: string, dashboard_name?: string, widget_title?: string, metric_id?: string }. ' +
        'For the optional keys, extract ONLY literal substrings that appear in the TICKET TEXT (subject or body). ' +
        'Do not guess, do not normalize or invent values, do not copy anything from Knowledge into those fields. ' +
        'If a value is not explicitly present in the ticket text, omit that key.'
    },
    { role: 'system', content: `Knowledge (for reasoning only, never for extraction):\n${knowledge}` },
    {
      role: 'user',
      content:
        `TICKET SUBJECT:\n${ticket.subject || '(no subject)'}\n\n` +
        `TICKET BODY:\n${ticket.description || '(no description)'}`
    }
  ];

  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.0,
    top_p: 1,
    messages
  });

  const text = r.choices?.[0]?.message?.content || '{}';

  // 1) parse loosely so bad fields do not throw
  let loose = {};
  try {
    loose = PlanSchemaLoose.parse(JSON.parse(text));
  } catch {
    loose = {};
  }

  // 2) sanitize - convert any non-literal to null
  const sanitized = sanitizePlan(loose, ticket);

  // 3) validate strictly - email and others may be null, and need_db is guaranteed
  return PlanSchemaStrict.parse(sanitized);
}

const TriageResultSchema = z.object({
  category: z.enum(['billing', 'bug', 'how_to', 'account', 'feature_request', 'other']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  language: z.string().min(2).max(8),
  tags: z.array(z.string()).max(10),
  summary: z.string().min(10).max(750),
  confidence: z.number().min(0).max(1),
  root_cause: z.string().optional(),      
  actions: z.array(z.string()).optional(),
  comment_private: z.string().optional()
});

export async function finalizeTriage({ ticket, checks = [] }) {
  const knowledge = await loadKnowledge();

  const schemaString = `
{
  "category": "billing" | "bug" | "how_to" | "account" | "feature_request" | "other",
  "priority": "low" | "normal" | "high" | "urgent",
  "language": string (2-8 characters),
  "tags": string[] (max 10),
  "summary": string (10 to 750 characters),
  "confidence": number from 0 to 1,
  "root_cause: string",
  "actions": string[],
  "comment_private": string
}
`.trim();

  const basePrompt = [
    {
      role: 'system',
      content: `You are a senior CX triage assistant. Use evidence from checks when present.
        Reply ONLY with a valid JSON object that exactly matches this schema:

        ${schemaString}

        All fields are required. Do NOT include markdown, comments, or explanations.`
            },
            { role: 'system', content: `Knowledge:\n${knowledge}` },
            {
              role: 'user',
              content:
                `Ticket:\nSubject: ${ticket.subject || '(no subject)'}\nBody:\n${ticket.description || '(no description)'}\n\n` +
                `Checks JSON:\n${JSON.stringify({ checks }, null, 2)}`
            }
          ];

  // step 1 — first call
  const first = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: basePrompt
  });

  let content = first.choices?.[0]?.message?.content || '{}';

  try {
    return TriageResultSchema.parse(JSON.parse(content));
  } catch (e) {
    // step 2 — retry by telling the model what went wrong
    const repairPrompt = [
      {
        role: 'system',
        content: `You previously returned a triage result but missed required fields. Retry now and reply ONLY with a valid JSON object that matches this schema:

          ${schemaString}

          All fields are required. Do NOT omit any key. Do NOT return markdown or explanations.`
      },
      { role: 'user', content: `Your last JSON:\n${content}` }
    ];

    const retry = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: repairPrompt
    });

    const fixedContent = retry.choices?.[0]?.message?.content || '{}';

    return TriageResultSchema.parse(JSON.parse(fixedContent));
  }
}

