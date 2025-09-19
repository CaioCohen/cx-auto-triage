import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import url from 'url';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

export async function answerQuestion({ query, fileId = null }) {
  const knowledge = await loadKnowledge();
 // system prompt with instructions
  const system = [
    'You are a helpful CX assistant. You have access to the product description and a complete mock database (provided as a file).',
    'When answering questions, you must always reference facts from the DB file if it is included.',
    'If the user asks about specific users, organizations, dashboards, projects, or metrics,',
    'you must extract the answer directly from the DB file without guessing or suggesting external tools.',
    'Only say "I dont know" if the information is truly missing from the DB.'
  ].join(' ');

  // Build the input array for Responses API
  const input = [
    { role: 'system', content: [{ type: 'input_text', text: system }] },
    { role: 'system', content: [{ type: 'input_text', text: `Product description:\n${knowledge}` }] }
  ];

  const parts = [{ type: 'input_text', text: query }];
  if (fileId) {
    parts.push({ type: 'input_file', file_id: fileId });
  }
  // user message with query and optional file
  input.push({ role: 'user', content: parts });

  const resp = await openai.responses.create({
    model: 'gpt-4o-mini',
    input,
    temperature: 0.2
  });

  const text = (resp.output_text || '').trim();
  return text || 'I could not find enough information to answer confidently.';
}
