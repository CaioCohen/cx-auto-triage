import { answerQuestion } from '../services/answer.service.js';
import { ensureDbFileId } from '../services/db_file.service.js';
// POST /api/answers/ask { query: string, includeDb?: boolean }
export async function askAnswer(req, res) {
  try {
    //Gets the query
    const { query, includeDb = true } = req.body || {};

    //checks if query is valid
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }

    // Generates the file for mock_db and gets the Id
    const fileId = await ensureDbFileId();
    
    const answer = await answerQuestion({ query, fileId });
    return res.json({ answer, usedDb: !!fileId });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'failed to answer' });
  }
}
