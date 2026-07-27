import {
  getLeadById,
  listLeads,
  updateLeadById,
} from '../lib/crm.js';
import {
  adminAuthorized,
  adminConfigured,
  adminSession,
  clearAdminSession,
  sameOriginMutation,
  setAdminSession,
  verifyAdminCredentials,
} from '../lib/admin-auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';

const X1_STATUS = new Set([
  'x1_contacted',
  'x1_qualified',
  'x1_offer_sent',
  'x1_payment_sent',
  'x1_lost',
]);
const LOST_REASONS = new Set([
  'nao_respondeu',
  'preco',
  'sem_dinheiro',
  'nao_confia',
  'frete_prazo',
  'desistiu',
  'outro',
]);

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function summarize(leads) {
  return leads.reduce((acc, lead) => {
    const status = lead.funnel_status || 'unknown';
    acc.total += 1;
    acc[status] = (acc[status] || 0) + 1;
    if (lead.payment_method === 'pix' && lead.funnel_status !== 'paid') acc.open_pix += 1;
    return acc;
  }, {
    total: 0,
    site_visit: 0,
    cta_click: 0,
    coupon_requested: 0,
    checkout_visit: 0,
    form_started: 0,
    form_submitted: 0,
    pix_generated: 0,
    paid: 0,
    abandoned: 0,
    payment_pending: 0,
    x1_contacted: 0,
    x1_qualified: 0,
    x1_offer_sent: 0,
    x1_payment_sent: 0,
    x1_lost: 0,
    open_pix: 0,
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  if (!adminConfigured()) {
    return res.status(503).json({ error: 'ADMIN_PANEL_USER ou ADMIN_PANEL_PASSWORD nao configurada.' });
  }

  const action = clean(req.body?.action || req.query?.action, 40);
  if (req.method === 'POST' && action === 'login') {
    if (!sameOriginMutation(req)) return res.status(403).json({ error: 'Origem nao autorizada.' });
    if (!enforceRateLimit(req, res, { namespace: 'admin-login', limit: 10, windowMs: 15 * 60 * 1000 })) return;
    const user = clean(req.body?.user, 200);
    const password = String(req.body?.password || '');
    if (!verifyAdminCredentials(user, password)) {
      return res.status(401).json({ error: 'Usuario ou senha invalido.' });
    }
    setAdminSession(res, user);
    return res.status(200).json({ ok: true, user });
  }

  if (req.method === 'POST' && action === 'logout') {
    clearAdminSession(res);
    return res.status(200).json({ ok: true });
  }

  if (!adminAuthorized(req)) return res.status(401).json({ error: 'Sessao expirada ou invalida.' });
  if (action === 'session') {
    return res.status(200).json({ ok: true, user: adminSession(req)?.user || '' });
  }

  if (req.method === 'POST') {
    if (!sameOriginMutation(req)) return res.status(403).json({ error: 'Origem nao autorizada.' });
    if (!enforceRateLimit(req, res, { namespace: 'admin-write', limit: 120, windowMs: 60 * 1000 })) return;
    const id = clean(req.body?.id, 80);
    const status = clean(req.body?.status, 40);
    const note = clean(req.body?.note, 1000);
    const lostReason = clean(req.body?.lost_reason, 300);
    const paymentUrl = clean(req.body?.payment_url, 1000);
    const channel = clean(req.body?.channel, 40);
    const kitId = Math.min(Math.max(parseInt(req.body?.kit_id, 10) || 0, 0), 3) || undefined;
    if (!id || !X1_STATUS.has(status)) {
      return res.status(400).json({ error: 'Lead ou etapa X1 invalida.' });
    }
    if (status === 'x1_lost' && !LOST_REASONS.has(lostReason)) {
      return res.status(400).json({ error: 'Selecione um motivo de perda valido.' });
    }

    const existing = await getLeadById(id);
    if (!existing) return res.status(404).json({ error: 'Lead nao encontrado.' });
    const event = {
      status,
      at: new Date().toISOString(),
      note: note || undefined,
      lost_reason: lostReason || undefined,
      payment_url: paymentUrl || undefined,
      kit_id: kitId,
      channel: channel || undefined,
    };
    const history = Array.isArray(existing.metadata?.x1_events)
      ? existing.metadata.x1_events
      : [];
    const lead = await updateLeadById(id, {
      funnel_status: status,
      metadata: {
        x1_origin_status: existing.metadata?.x1_origin_status || existing.funnel_status,
        x1_last_status: status,
        x1_last_note: note || undefined,
        x1_lost_reason: lostReason || undefined,
        x1_payment_url: paymentUrl || undefined,
        x1_payment_kit: kitId,
        x1_last_channel: channel || undefined,
        x1_payment_sent_at: status === 'x1_payment_sent' ? event.at : undefined,
        x1_events: history.concat(event).slice(-40),
      },
    });
    if (!lead) return res.status(500).json({ error: 'Nao foi possivel atualizar o lead.' });
    return res.status(200).json({ ok: true, lead });
  }

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
