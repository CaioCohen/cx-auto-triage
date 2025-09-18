import fs from 'fs/promises';
import path from 'path';
import url from 'url';

/* ---------- DB loader ---------- */

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DB_PATH = process.env.MOCK_DB_PATH || path.join(__dirname, '../../data/mock_db.json');

let CACHE = null;
export async function loadDb() {
  if (!CACHE) {
    const raw = await fs.readFile(DB_PATH, 'utf-8');
    CACHE = JSON.parse(raw);
  }
  return CACHE;
}

/* ---------- primitive checks (already safe to call directly) ---------- */

export async function user_is_active({ email }) {
  const db = await loadDb();
  const user = db.users.find(u => u.email?.toLowerCase() === String(email || '').toLowerCase());
  return { ok: !!user && user.active === true, details: user ? { user_id: user.id, active: user.active, org_id: user.org_id } : { reason: 'user_not_found' } };
}

export async function user_has_project_scope({ email, project, scope }) {
  const db = await loadDb();
  const user = db.users.find(u => u.email?.toLowerCase() === String(email || '').toLowerCase());
  if (!user) return { ok: false, details: { reason: 'user_not_found' } };

  const proj = db.projects.find(p => p.org_id === user.org_id && p.name?.toLowerCase() === String(project || '').toLowerCase());
  if (!proj) return { ok: false, details: { reason: 'project_not_found' } };

  const perm = db.permissions.find(p => p.user_id === user.id && p.project_id === proj.id);
  const ok = !!perm && Array.isArray(perm.scopes) && perm.scopes.includes(scope);
  return { ok, details: { user_id: user.id, project_id: proj.id, scopes: perm?.scopes || [] } };
}

export async function project_by_name({ org_id, name }) {
  const db = await loadDb();
  const proj = db.projects.find(p => p.org_id === org_id && p.name?.toLowerCase() === String(name || '').toLowerCase());
  return { ok: !!proj, details: proj || { reason: 'project_not_found' } };
}

export async function dashboard_by_name({ project_name, org_id, name }) {
  const db = await loadDb();
  const proj = db.projects.find(p => p.org_id === org_id && p.name?.toLowerCase() === String(project_name || '').toLowerCase());
  if (!proj) return { ok: false, details: { reason: 'project_not_found' } };
  const dash = db.dashboards.find(d => d.project_id === proj.id && d.name?.toLowerCase() === String(name || '').toLowerCase());
  return { ok: !!dash, details: dash || { reason: 'dashboard_not_found' } };
}

export async function widget_by_title({ dashboard_name, project_name, org_id, title }) {
  const db = await loadDb();
  const proj = db.projects.find(p => p.org_id === org_id && p.name?.toLowerCase() === String(project_name || '').toLowerCase());
  if (!proj) return { ok: false, details: { reason: 'project_not_found' } };
  const dash = db.dashboards.find(d => d.project_id === proj.id && d.name?.toLowerCase() === String(dashboard_name || '').toLowerCase());
  if (!dash) return { ok: false, details: { reason: 'dashboard_not_found' } };
  const w = db.widgets.find(w => w.dashboard_id === dash.id && w.title?.toLowerCase() === String(title || '').toLowerCase());
  return { ok: !!w, details: w || { reason: 'widget_not_found' } };
}

export async function widget_is_visible(args) {
  const res = await widget_by_title(args);
  if (!res.ok) return res;
  const w = res.details;
  return { ok: !!w.visible && !w.archived, details: { id: w.id, visible: !!w.visible, archived: !!w.archived } };
}

export async function metric_has_recent_data({ metric_id, days = 1 }) {
  const db = await loadDb();
  const since = new Date();
  since.setDate(since.getDate() - Number(days || 1));
  const has = db.metric_samples.some(s => s.metric_id === metric_id && new Date(s.date) >= since);
  return { ok: has, details: { metric_id, since: since.toISOString().slice(0, 10) } };
}

export async function feature_flag_enabled({ org_id, key }) {
  const db = await loadDb();
  const flag = db.feature_flags.find(f => f.key === key);
  if (!flag) return { ok: false, details: { reason: 'flag_not_found' } };
  const enabled = !!flag.enabled && (
    Array.isArray(flag.enabled_for_orgs) ? flag.enabled_for_orgs.includes(org_id) : true
  );
  return { ok: enabled, details: { key, enabled: !!flag.enabled, enabled_for_orgs: flag.enabled_for_orgs || [] } };
}

/* ---------- context inference from the ticket ---------- */

function findFirstEmail(text) {
  const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

export async function extractContextFromTicket(ticket) {
  const db = await loadDb();
  const text = `${ticket.subject || ''}\n${ticket.description || ''}`;

  // email
  let email = findFirstEmail(text);
  // If Zendesk supplies requester in your controller, you can set email = ticket.requester.email

  // org from user
  let org_id = null;
  if (email) {
    const u = db.users.find(x => x.email?.toLowerCase() === email);
    if (u) org_id = u.org_id;
  }
  if (!org_id && db.orgs.length) {
    // fallback demo behavior
    org_id = db.orgs[0].id;
  }

  // project name guess
  const project_names = db.projects.map(p => p.name).sort((a, b) => b.length - a.length);
  const project_name = project_names.find(n => text.toLowerCase().includes(n.toLowerCase())) || null;

  // dashboard name guess
  const dashboards = db.dashboards.map(d => d.name).sort((a, b) => b.length - a.length);
  const dashboard_name = dashboards.find(n => text.toLowerCase().includes(n.toLowerCase())) || null;

  // widget title guess: prefer quoted "Widget Title"
  let widget_title = null;
  const quoted = text.match(/"([^"]{3,80})"/g);
  if (quoted) {
    const qvals = quoted.map(q => q.replace(/"/g, ''));
    widget_title = qvals.find(q => db.widgets.some(w => w.title?.toLowerCase() === q.toLowerCase())) || null;
  }
  if (!widget_title) {
    const titles = db.widgets.map(w => w.title).sort((a, b) => b.length - a.length);
    widget_title = titles.find(t => text.toLowerCase().includes(t.toLowerCase())) || null;
  }

  // metric id if we resolved a widget
  let metric_id = null;
  if (widget_title && project_name && org_id && dashboard_name) {
    const proj = db.projects.find(p => p.org_id === org_id && p.name.toLowerCase() === project_name.toLowerCase());
    const dash = proj && db.dashboards.find(d => d.project_id === proj.id && d.name.toLowerCase() === dashboard_name.toLowerCase());
    const widget = dash && db.widgets.find(w => w.dashboard_id === dash.id && w.title.toLowerCase() === widget_title.toLowerCase());
    if (widget) metric_id = widget.metric_id || null;
  }

  return { email, org_id, project_name, dashboard_name, widget_title, metric_id };
}

/* ---------- auto check pack ---------- */

export async function runAutoChecks(ticket, providedContext = {}) {
  // infer from text as a fallback
  const inferred = await extractContextFromTicket(ticket);

  // planner-provided context wins over inference when present
  const ctx = {
    ...inferred,
    ...Object.fromEntries(Object.entries(providedContext || {}).filter(([, v]) => v != null && v !== ''))
  };

  const results = [];

  if (ctx.email) {
    const db = await loadDb();
    const u = db.users.find(x => x.email?.toLowerCase() === ctx.email.toLowerCase());
    if (u && u.org_id && ctx.org_id && ctx.org_id !== u.org_id) {
      ctx.org_id = u.org_id;
    } else if (u && u.org_id && !ctx.org_id) {
      ctx.org_id = u.org_id;
    }
    results.push({ name: 'user_is_active', ...(await user_is_active({ email: ctx.email })) });
  }

  if (ctx.org_id) {
    results.push({ name: 'feature_flag_enabled', ...(await feature_flag_enabled({ org_id: ctx.org_id, key: 'widgets.grid_v2' })) });
  }

  if (ctx.project_name && ctx.org_id) {
    results.push({ name: 'project_by_name', ...(await project_by_name({ org_id: ctx.org_id, name: ctx.project_name })) });

    if (ctx.email) {
      results.push({ name: 'user_has_project_scope', ...(await user_has_project_scope({ email: ctx.email, project: ctx.project_name, scope: 'viewer' })) });
    }
  }

  if (ctx.project_name && ctx.dashboard_name && ctx.org_id) {
    results.push({ name: 'dashboard_by_name', ...(await dashboard_by_name({ project_name: ctx.project_name, org_id: ctx.org_id, name: ctx.dashboard_name })) });
  }

  if (ctx.project_name && ctx.dashboard_name && ctx.org_id && ctx.widget_title) {
    const vis = await widget_is_visible({
      project_name: ctx.project_name,
      dashboard_name: ctx.dashboard_name,
      org_id: ctx.org_id,
      title: ctx.widget_title
    });
    results.push({ name: 'widget_is_visible', ...vis });

    if (ctx.metric_id) {
      results.push({ name: 'metric_has_recent_data', ...(await metric_has_recent_data({ metric_id: ctx.metric_id, days: 1 })) });
    }
  }

  return { context: ctx, checks: results };
}