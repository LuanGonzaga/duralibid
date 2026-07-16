const DEFAULT_VERSION = 'v25.0';

function authorized(req) {
  const user = process.env.ADMIN_PANEL_USER;
  const password = process.env.ADMIN_PANEL_PASSWORD;
  if (!user || !password) return false;
  return req.headers['x-admin-user'] === user && req.headers['x-admin-password'] === password;
}

function configured() {
  return Boolean(process.env.META_AD_ACCOUNT_ID && adsToken());
}

function adsToken() {
  return process.env.META_ADS_ACCESS_TOKEN || process.env.META_MARKETING_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
}

function normalizeAccountId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.startsWith('act_') ? clean : `act_${clean}`;
}

function graphVersion() {
  const version = String(process.env.META_GRAPH_VERSION || DEFAULT_VERSION).trim();
  return version.startsWith('v') ? version : `v${version}`;
}

function periodLabel(period) {
  return {
    today: 'Hoje',
    yesterday: 'Ontem',
    last_7d: 'Ultimos 7 dias',
    last_14d: 'Ultimos 14 dias',
    last_30d: 'Ultimos 30 dias',
    this_month: 'Este mes',
  }[period] || 'Ultimos 7 dias';
}

function normalizePeriod(value) {
  const allowed = new Set(['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month']);
  return allowed.has(value) ? value : 'last_7d';
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function actionValue(items, names) {
  if (!Array.isArray(items)) return 0;
  const wanted = new Set(names);
  return items.reduce((total, item) => {
    if (wanted.has(item.action_type)) return total + toNumber(item.value);
    return total;
  }, 0);
}

function firstRoas(items) {
  if (!Array.isArray(items)) return 0;
  const row = items.find((item) => item.value != null);
  return toNumber(row?.value);
}

function parseInsight(row = {}) {
  const spend = toNumber(row.spend);
  const purchases = actionValue(row.actions, [
    'purchase',
    'omni_purchase',
    'offsite_conversion.fb_pixel_purchase',
  ]);
  const leads = actionValue(row.actions, [
    'lead',
    'omni_lead',
    'offsite_conversion.fb_pixel_lead',
    'complete_registration',
    'offsite_conversion.fb_pixel_complete_registration',
  ]);
  const checkouts = actionValue(row.actions, [
    'initiate_checkout',
    'offsite_conversion.fb_pixel_initiate_checkout',
  ]);
  const purchaseValue = actionValue(row.action_values, [
    'purchase',
    'omni_purchase',
    'offsite_conversion.fb_pixel_purchase',
  ]);
  const roas = firstRoas(row.purchase_roas) || (spend ? purchaseValue / spend : 0);

  return {
    account_id: row.account_id || '',
    account_name: row.account_name || '',
    campaign_id: row.campaign_id || '',
    campaign_name: row.campaign_name || '',
    date_start: row.date_start || '',
    date_stop: row.date_stop || '',
    currency: row.account_currency || 'BRL',
    spend,
    impressions: toNumber(row.impressions),
    reach: toNumber(row.reach),
    clicks: toNumber(row.clicks),
    link_clicks: toNumber(row.inline_link_clicks || row.clicks),
    ctr: toNumber(row.ctr),
    cpc: toNumber(row.cpc),
    cpm: toNumber(row.cpm),
    purchases,
    leads,
    checkouts,
    purchase_value: purchaseValue,
    roas,
    cost_per_purchase: purchases ? spend / purchases : 0,
    cost_per_lead: leads ? spend / leads : 0,
  };
}

async function metaGet(path, params) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  url.searchParams.set('access_token', adsToken());

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const message = data?.error?.message || 'Erro ao consultar Meta Ads.';
    const err = new Error(message);
    err.status = res.status || 502;
    err.meta = data?.error;
    throw err;
  }
  return data;
}

async function loadAccountInsights(account, period) {
  const data = await metaGet(`${account}/insights`, {
    level: 'account',
    date_preset: period,
    fields: [
      'account_id',
      'account_name',
      'account_currency',
      'spend',
      'impressions',
      'reach',
      'clicks',
      'inline_link_clicks',
      'cpc',
      'cpm',
      'ctr',
      'actions',
      'action_values',
      'purchase_roas',
    ].join(','),
  });
  return parseInsight(data.data?.[0] || {});
}

async function loadDailyInsights(account, period) {
  const data = await metaGet(`${account}/insights`, {
    level: 'account',
    date_preset: period,
    time_increment: 1,
    fields: [
      'date_start',
      'date_stop',
      'spend',
      'impressions',
      'clicks',
      'inline_link_clicks',
      'actions',
      'action_values',
      'purchase_roas',
    ].join(','),
    limit: 90,
  });
  return (data.data || []).map(parseInsight);
}

async function loadCampaignInsights(account, period) {
  const data = await metaGet(`${account}/insights`, {
    level: 'campaign',
    date_preset: period,
    fields: [
      'campaign_id',
      'campaign_name',
      'spend',
      'impressions',
      'reach',
      'clicks',
      'inline_link_clicks',
      'cpc',
      'cpm',
      'ctr',
      'actions',
      'action_values',
      'purchase_roas',
    ].join(','),
    limit: 50,
  });
  return (data.data || [])
    .map(parseInsight)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-User, X-Admin-Password');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ADMIN_PANEL_USER || !process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PANEL_USER ou ADMIN_PANEL_PASSWORD nao configurada.' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'Usuario ou senha invalido.' });

  if (!configured()) {
    return res.status(200).json({
      configured: false,
      required: ['META_AD_ACCOUNT_ID', 'META_ADS_ACCESS_TOKEN'],
      message: 'Configure META_AD_ACCOUNT_ID e META_ADS_ACCESS_TOKEN para exibir metricas do Meta Ads.',
    });
  }

  const period = normalizePeriod(req.query?.period);
  const account = normalizeAccountId(process.env.META_AD_ACCOUNT_ID);

  try {
    const [summary, daily, campaigns] = await Promise.all([
      loadAccountInsights(account, period),
      loadDailyInsights(account, period),
      loadCampaignInsights(account, period),
    ]);

    return res.status(200).json({
      configured: true,
      account_id: account,
      period,
      period_label: periodLabel(period),
      graph_version: graphVersion(),
      summary,
      daily,
      campaigns,
    });
  } catch (err) {
    console.error('Meta Ads error:', err.meta || err.message);
    return res.status(err.status || 502).json({
      configured: true,
      error: err.message || 'Erro ao consultar Meta Ads.',
    });
  }
}
