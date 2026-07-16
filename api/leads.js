import { listLeads } from '../lib/crm.js';

function authorized(req) {
  const user = process.env.ADMIN_PANEL_USER;
  const password = process.env.ADMIN_PANEL_PASSWORD;
  if (!user || !password) return false;
  return req.headers['x-admin-user'] === user && req.headers['x-admin-password'] === password;
}

function summarize(leads) {
  return leads.reduce((acc, lead) => {
    const status = lead.funnel_status || 'unknown';
    acc.total += 1;
    acc[status] = (acc[status] || 0) + 1;
    if (lead.payment_method === 'pix' && lead.funnel_status !== 'paid') acc.open_pix += 1;
    return acc;
  }, { total: 0, checkout_visit: 0, pix_generated: 0, paid: 0, abandoned: 0, payment_pending: 0, open_pix: 0 });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-User, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ADMIN_PANEL_USER || !process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PANEL_USER ou ADMIN_PANEL_PASSWORD nao configurada.' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'Usuario ou senha invalido.' });

  const { status = 'all', q = '', limit = '200' } = req.query || {};
  const result = await listLeads({ status, q, limit });
  if (!result.configured) {
    return res.status(503).json({ error: 'Supabase nao configurado.', leads: [], summary: summarize([]) });
  }
  if (result.error) {
    return res.status(500).json({ error: result.error, leads: [], summary: summarize([]) });
  }

  return res.status(200).json({
    leads: result.leads,
    summary: summarize(result.leads),
  });
}
