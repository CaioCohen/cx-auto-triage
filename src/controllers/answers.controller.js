import fs from 'fs/promises';
import path from 'path';
import url from 'url';
import { answerQuestion } from '../services/answer.service.js';
import { ensureDbFileId } from '../services/db_file.service.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DB_PATH = process.env.MOCK_DB_PATH || path.join(__dirname, '../../data/mock_db.json');

// POST /api/answers/ask { query: string, includeDb?: boolean }
export async function askAnswer(req, res) {
  try {
    const { query, includeDb = true } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }
    const fileId = await ensureDbFileId();
    const answer = await answerQuestion({ query, fileId });
    return res.json({ answer, usedDb: !!fileId });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed to answer' });
  }
}
