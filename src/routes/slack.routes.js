import { Router } from 'express';
import { askAnswer } from '../controllers/answers.controller.js';

const router = Router();

router.post('/command', async (req, res) => {
  try {
    // Basic shape: /ask_observe <query text>
    const query = String(req.body?.text || '').trim();
    if (!query) {
      return res.json({ response_type: 'ephemeral', text: 'Usage: /ask_observe <your question>' });
    }

    // naive heuristic: if question mentions widget/project/dashboard/metric, include DB
    const includeDb = /\b(widget|project|dashboard|metric|permission|access)\b/i.test(query);
    const fakeReq = { body: { query, includeDb } };
    const fakeRes = {
      json: (data) => data
    };
    const result = await askAnswer(fakeReq, fakeRes);
    // askAnswer would normally write res.json; we can call answer service directly instead:
    // const answer = await answerQuestion({ query });

    // If askAnswer returned undefined because it wrote directly, call service:
    let payload;
    if (!result) {
      // fallback path
      payload = { answer: 'No answer generated.' };
    } else {
      payload = result;
    }

    return res.json({
      response_type: 'ephemeral',
      text: payload.answer
    });
  } catch (e) {
    return res.json({ response_type: 'ephemeral', text: 'Error answering your question.' });
  }
});

export default router;
