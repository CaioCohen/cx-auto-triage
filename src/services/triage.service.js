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
  const knowledge = await loadKnowledge(); // load knowledge once

  // Build messages for chat completion
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

export async function finalizeTriage({ ticket, fileId = null }) {
  const knowledge = await loadKnowledge(); // load knowledge once

  // JSON schema as string for prompt
  const schemaString = `
    {
      "category": "billing" | "bug" | "how_to" | "account" | "feature_request" | "other",
      "priority": "low" | "normal" | "high" | "urgent",
      "language": string (2-8 characters),
      "tags": string[] (max 10),
      "summary": string (10 to 750 characters),
      "confidence": number from 0 to 1
    }`.trim();

    // system prompt with instructions
  const systemText =
    `You are a senior CX triage assistant. Use the product description and, if provided as an input file, the DB JSON as ground truth.
    Reply ONLY with a valid JSON object that exactly matches this schema:

    ${schemaString}

    All fields are required. Do not include markdown, comments, or explanations.`;

      const userTicketText = `Ticket:
    Subject: ${ticket.subject || '(no subject)'}
    Body:
    ${ticket.description || '(no description)'}`;

  // Build the input array for Responses API
  const input = [
    { role: 'system', content: [{ type: 'input_text', text: systemText }] },
    { role: 'system', content: [{ type: 'input_text', text: `Product description:\n${knowledge}` }] }
  ];

  // User message with or without the DB file
  const userParts = [{ type: 'input_text', text: userTicketText }];
  if (fileId) {
    userParts.push({ type: 'input_file', file_id: fileId });
  }
  input.push({ role: 'user', content: userParts });

  // Create response
  const resp = await openai.responses.create({
    model: 'gpt-4o-mini',
    input,
    temperature: 0.2
  });

  let text = resp.output_text || '{}';
  try {
    return TriageResultSchema.parse(JSON.parse(text));
  } catch {
    // one repair pass - also use input_text for all parts
    const repair = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: [
        { role: 'system', content: [{ type: 'input_text', text:
          `You returned an invalid triage JSON. Retry and return ONLY a valid JSON object that matches the schema:

          ${schemaString}

          All fields are required.` }] },
                  { role: 'user', content: [{ type: 'input_text', text }] }
                ],
                temperature: 0.1
              });
    const fixed = repair.output_text || '{}';
    return TriageResultSchema.parse(JSON.parse(fixed));
  }
}

