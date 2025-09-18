import axios from 'axios';

const {
  ZENDESK_SUBDOMAIN,
  ZENDESK_EMAIL,
  ZENDESK_API_TOKEN,
} = process.env;

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  throw new Error('Missing Zendesk env vars');
}

const ZENDESK_BASE = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const ZENDESK_AUTH = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');

function client() {
  return axios.create({
    baseURL: ZENDESK_BASE,
    headers: { Authorization: `Basic ${ZENDESK_AUTH}` },
    timeout: 15000
  });
}

// returns full ticket objects so controllers can decide what to expose
export async function listTickets({ limit = 50, status = 'new' } = {}) {
  const res = await client().get('/tickets.json', {
    params: { sort_by: 'created_at', sort_order: 'desc', per_page: Math.min(limit, 100) }
  });
  const tickets = res.data?.tickets ?? [];
  return status ? tickets.filter(t => t.status === status) : tickets;
}

// partial update for one ticket
export async function updateTicket(ticketId, { tags, priority, comment }) {
  const body = {
    ticket: {
      ...(tags ? { tags } : {}),
      ...(priority ? { priority } : {}),
      ...(comment ? { comment } : {})
    }
  };
  await client().put(`/tickets/${ticketId}.json`, body);
}
