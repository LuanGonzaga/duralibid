const DEFAULT_VERSION = 'v25.0';

function authorized(req) {
  const user = process.env.ADMIN_PANEL_USER;
  const password = process.env.ADMIN_PANEL_PASSWORD;
  if (!user || !password) return false;
  return req.headers['x-admin-user'] === user && req.headers['x-admin-password'] === password;
}

function adsToken() {
  return process.env.META_ADS_ACCESS_TOKEN || process.env.META_MARKETING_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
}

function graphVersion() {
  const version = String(process.env.META_GRAPH_VERSION || DEFAULT_VERSION).trim();
  return version.startsWith('v') ? version : `v${version}`;
}

function normalizeAccountId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.startsWith('act_') ? clean : `act_${clean}`;
}

function configured() {
  return Boolean(process.env.META_AD_ACCOUNT_ID && adsToken());
}

async function metaRequest(path, params = {}, method = 'GET') {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (method === 'GET') url.searchParams.set(key, String(value));
    else body.set(key, String(value));
  });
  if (method === 'GET') url.searchParams.set('access_token', adsToken());
  else body.set('access_token', adsToken());

  const res = await fetch(url.toString(), {
    method,
    headers: method === 'GET'
      ? { Accept: 'application/json' }
      : { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(data?.error?.message || 'Erro ao consultar Meta Ads.');
    err.status = res.status || 502;
    err.meta = data?.error;
    throw err;
  }
  return data;
}

function parseAdset(adset) {
  return {
    id: adset.id,
    name: adset.name,
    campaign_id: adset.campaign_id,
    campaign_name: adset.campaign?.name || '',
    campaign_objective: adset.campaign?.objective || '',
    status: adset.status,
    effective_status: adset.effective_status,
    optimization_goal: adset.optimization_goal,
    billing_event: adset.billing_event,
    promoted_object: adset.promoted_object || {},
    daily_budget: adset.daily_budget ? Number(adset.daily_budget) / 100 : null,
    lifetime_budget: adset.lifetime_budget ? Number(adset.lifetime_budget) / 100 : null,
    bid_strategy: adset.bid_strategy || '',
    attribution_spec: adset.attribution_spec || [],
  };
}

function normalizeEvent(value) {
  const allowed = new Set(['LEAD', 'INITIATE_CHECKOUT', 'ADD_PAYMENT_INFO', 'PURCHASE', 'VIEW_CONTENT']);
  const event = String(value || 'LEAD').trim().toUpperCase();
  return allowed.has(event) ? event : 'LEAD';
}

async function pauseAllDelivery() {
  const account = normalizeAccountId(process.env.META_AD_ACCOUNT_ID);
  const campaignsData = await metaRequest(`${account}/campaigns`, {
    fields: 'id,name,status,effective_status',
    limit: 200,
  });
  const campaigns = campaignsData.data || [];
  const activeCampaigns = campaigns.filter((item) => (
    item.status === 'ACTIVE' || item.effective_status === 'ACTIVE'
  ));
  const pausedCampaigns = [];
  for (const campaign of activeCampaigns) {
    const result = await metaRequest(campaign.id, { status: 'PAUSED' }, 'POST');
    pausedCampaigns.push({
      id: campaign.id,
      name: campaign.name,
      status_before: campaign.status,
      effective_status_before: campaign.effective_status,
      paused: result.success === true,
    });
  }

  const adsetsData = await metaRequest(`${account}/adsets`, {
    fields: 'id,name,status,effective_status,campaign_id',
    limit: 300,
  });
  const adsets = adsetsData.data || [];
  const activeAdsets = adsets.filter((item) => (
    item.status === 'ACTIVE' || item.effective_status === 'ACTIVE'
  ));
  const pausedAdsets = [];
  for (const adset of activeAdsets) {
    const result = await metaRequest(adset.id, { status: 'PAUSED' }, 'POST');
    pausedAdsets.push({
      id: adset.id,
      name: adset.name,
      campaign_id: adset.campaign_id,
      status_before: adset.status,
      effective_status_before: adset.effective_status,
      paused: result.success === true,
    });
  }

  return {
    paused_campaigns_count: pausedCampaigns.length,
    paused_adsets_count: pausedAdsets.length,
    paused_campaigns: pausedCampaigns,
    paused_adsets: pausedAdsets,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-User, X-Admin-Password');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ADMIN_PANEL_USER || !process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PANEL_USER ou ADMIN_PANEL_PASSWORD nao configurada.' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'Usuario ou senha invalido.' });
  if (!configured()) {
    return res.status(503).json({ error: 'META_AD_ACCOUNT_ID ou META_ADS_ACCESS_TOKEN nao configurada.' });
  }

  try {
    if (req.method === 'GET') {
      const account = normalizeAccountId(process.env.META_AD_ACCOUNT_ID);
      const data = await metaRequest(`${account}/adsets`, {
        fields: [
          'id',
          'name',
          'campaign_id',
          'campaign{name,objective,status,effective_status}',
          'status',
          'effective_status',
          'optimization_goal',
          'billing_event',
          'promoted_object',
          'attribution_spec',
          'daily_budget',
          'lifetime_budget',
          'bid_strategy',
        ].join(','),
        limit: 100,
      });

      return res.status(200).json({
        configured: true,
        graph_version: graphVersion(),
        adsets: (data.data || []).map(parseAdset),
      });
    }

    if (req.body?.action === 'pause_all') {
      const result = await pauseAllDelivery();
      return res.status(200).json({ ok: true, ...result });
    }

    const { adset_id: adsetId, event = 'LEAD', dry_run: dryRun = true } = req.body || {};
    if (!adsetId) return res.status(400).json({ error: 'adset_id obrigatorio.' });
    if (!process.env.META_PIXEL_ID) return res.status(503).json({ error: 'META_PIXEL_ID nao configurada.' });

    const customEventType = normalizeEvent(event);
    const payload = {
      optimization_goal: 'OFFSITE_CONVERSIONS',
      promoted_object: JSON.stringify({
        pixel_id: process.env.META_PIXEL_ID,
        custom_event_type: customEventType,
      }),
    };
    if (dryRun) payload.execution_options = JSON.stringify(['validate_only']);

    const data = await metaRequest(adsetId, payload, 'POST');
    return res.status(200).json({
      ok: true,
      dry_run: Boolean(dryRun),
      adset_id: adsetId,
      optimization_goal: payload.optimization_goal,
      custom_event_type: customEventType,
      meta: data,
    });
  } catch (err) {
    console.error('Meta adsets error:', err.meta || err.message);
    return res.status(err.status || 502).json({
      error: err.message || 'Erro ao consultar Meta Ads.',
      meta: err.meta,
    });
  }
}
