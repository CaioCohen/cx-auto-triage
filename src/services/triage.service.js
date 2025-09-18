import OpenAI from 'openai';
import { z } from 'zod';

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const TriagedSchema = z.object({
  category: z.enum(['billing','bug','how_to','account','feature_request','other']),
  priority: z.enum(['low','normal','high','urgent']),
  language: z.string().min(2).max(8),
  tags: z.array(z.string()).max(10),
  summary: z.string().min(10).max(750),
  confidence: z.number().min(0).max(1)
});

export async function triageTicket(ticket) {
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
