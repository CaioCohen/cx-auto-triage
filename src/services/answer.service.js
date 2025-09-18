import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import url from 'url';

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const KNOWLEDGE_PATH = process.env.KNOWLEDGE_PATH || path.join(__dirname, '../../knowledge/description.txt');
const FAQS_PATH = process.env.FAQS_PATH || path.join(__dirname, '../../knowledge/faqs.json');

let KN = null;
let FAQS = null;

async function loadKnowledge() {
  if (KN == null) {
    try { KN = await fs.readFile(KNOWLEDGE_PATH, 'utf-8'); }
    catch { KN = 'Product description missing.'; }
  }
  return KN;
}

async function loadFaqs() {
  if (FAQS == null) {
    try {
      const raw = await fs.readFile(FAQS_PATH, 'utf-8');
      FAQS = JSON.parse(raw);
    } catch {
      FAQS = [];
    }
  }
  return FAQS;
}

function asFaqText(faqs, limit = 6) {
  if (!faqs || !faqs.length) return 'No FAQs available.';
  const list = faqs.slice(0, limit).map(f => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
  return list;
}

// Pass dbText if you want the agent to use your mock DB as additional context
export async function answerQuestion({ query, dbText = null }) {
  const knowledge = await loadKnowledge();
  const faqs = await loadFaqs();
  const faqText = asFaqText(faqs);

  const messages = [
    {
      role: 'system',
      content:
        `You are a helpful support assistant for Observe Lite.
        Use the product description and FAQs as ground truth.
        Always answer concisely in plain text and include a short "Next steps" section when helpful.`
            },
            { role: 'system', content: `Product description:\n${knowledge}` },
            { role: 'system', content: `FAQs:\n${faqText}` },
            { role: 'user', content: `Question:\n${query}` }
        ];

  if (dbText) {
    messages.push({
      role: 'user',
      content: `Optional DB JSON (if relevant to the answer):\n${dbText.slice(0, 100000)}`
    });
  }

  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.2
  });

  return r.choices?.[0]?.message?.content?.trim() || 'No answer generated.';
}
