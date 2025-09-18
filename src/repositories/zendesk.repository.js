import axios from 'axios';

const { ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN } = process.env;
if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  throw new Error('Missing Zendesk env vars');
}

const ZENDESK_BASE = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const ZENDESK_AUTH = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');

export class ZendeskApiError extends Error {
  constructor(message, { code, status, data } = {}) {
    super(message);
    this.name = 'ZendeskApiError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

function client() {
  return axios.create({
    baseURL: ZENDESK_BASE,
    headers: { Authorization: `Basic ${ZENDESK_AUTH}` },
    timeout: 15000
  });
}

// Maps axios errors to a stable app error
function wrapAxiosError(e, fallbackMsg = 'Zendesk request failed') {
  const status = e?.response?.status;
  const data = e?.response?.data;
  if (status === 404) {
    return new ZendeskApiError('Ticket not found', { code: 'ZENDESK_NOT_FOUND', status, data });
  }
  if (status === 403) {
    return new ZendeskApiError('Forbidden. API user cannot access this ticket', { code: 'ZENDESK_FORBIDDEN', status, data });
  }
  if (status === 429) {
    return new ZendeskApiError('Rate limited by Zendesk', { code: 'ZENDESK_RATE_LIMIT', status, data });
  }
  return new ZendeskApiError(fallbackMsg, { code: 'ZENDESK_HTTP_ERROR', status, data });
}

// Returns full ticket objects so controllers decide what to expose
export async function listTickets({ limit = 50, status = 'new' } = {}) {
  try {
    const res = await client().get('/tickets.json', {
      params: { sort_by: 'created_at', sort_order: 'desc', per_page: Math.min(limit, 100) }
    });
    const tickets = res.data?.tickets ?? [];
    return status ? tickets.filter(t => t.status === status) : tickets;
  } catch (e) {
    throw wrapAxiosError(e, 'Failed to list tickets');
  }
}

export async function getTicketById(id) {
  try {
    const res = await client().get(`/tickets/${id}.json`);
    console.log(res);
    return res.data?.ticket || null;
  } catch (e) {
    throw wrapAxiosError(e, 'Failed to fetch ticket');
  }
}

export async function updateTicket(ticketId, { tags, priority, comment }) {
  try {
    const body = {
      ticket: {
        ...(tags ? { tags } : {}),
        ...(priority ? { priority } : {}),
        ...(comment ? { comment } : {})
      }
    };
    await client().put(`/tickets/${ticketId}.json`, body);
  } catch (e) {
    throw wrapAxiosError(e, 'Failed to update ticket');
  }
}

export async function createTicket(ticket) {
  try {
    const res = await client().post('/tickets.json', { ticket });
    return res.data?.ticket;
  } catch (e) {
    throw wrapAxiosError(e, 'Failed to create ticket');
  }
}
