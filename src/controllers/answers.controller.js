import fs from 'fs/promises';
import path from 'path';
import url from 'url';
import { answerQuestion } from '../services/answer.service.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DB_PATH = process.env.MOCK_DB_PATH || path.join(__dirname, '../../data/mock_db.json');

async function loadDbTextMaybe(includeDb) {
  if (!includeDb) return null;
  try { return await fs.readFile(DB_PATH, 'utf-8'); }
  catch { return null; }
}

// POST /api/answers/ask { query: string, includeDb?: boolean }
export async function askAnswer(req, res) {
  try {
    const { query, includeDb = false } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }
    const dbText = await loadDbTextMaybe(includeDb);
    const answer = await answerQuestion({ query, dbText });
    return res.json({ answer, usedDb: !!dbText });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed to answer' });
  }
}
