const DEFAULT_VERSION = 'v25.0';
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

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

function ymdInTimezone(date = new Date(), timeZone = process.env.META_ADS_TIMEZONE || DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftYmd(ymd, days) {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(ymd) {
  return `${ymd.slice(0, 8)}01`;
}

function periodRange(period) {
  const today = ymdInTimezone();
  const yesterday = shiftYmd(today, -1);
  const ranges = {
    today: { since: today, until: today },
    yesterday: { since: yesterday, until: yesterday },
    last_7d: { since: shiftYmd(today, -6), until: today },
    last_14d: { since: shiftYmd(today, -13), until: today },
    last_30d: { since: shiftYmd(today, -29), until: today },
    this_month: { since: monthStart(today), until: today },
  };
  return ranges[period] || ranges.last_7d;
}

function actionValue(items, names) {
  if (!Array.isArray(items)) return 0;
  const wanted = new Set(names);
  return items.reduce((total, item) => {
    if (wanted.has(item.action_type)) return total + toNumber(item.value);
    return total;
  }, 0);
}

function actionCost(items, names) {
  if (!Array.isArray(items)) return 0;
  const wanted = new Set(names);
  const row = items.find((item) => wanted.has(item.action_type) && item.value != null);
  return toNumber(row?.value);
}

function sumActionField(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((total, item) => total + toNumber(item.value), 0);
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
  const landingPageViews = actionValue(row.actions, [
    'landing_page_view',
  ]);
  const contentViews = actionValue(row.actions, [
    'view_content',
    'omni_view_content',
    'offsite_conversion.fb_pixel_view_content',
  ]);
  const addToCart = actionValue(row.actions, [
    'add_to_cart',
    'omni_add_to_cart',
    'offsite_conversion.fb_pixel_add_to_cart',
  ]);
  const checkouts = actionValue(row.actions, [
    'initiate_checkout',
    'offsite_conversion.fb_pixel_initiate_checkout',
    'omni_initiated_checkout',
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
    frequency: toNumber(row.frequency),
    clicks: toNumber(row.clicks),
    unique_clicks: toNumber(row.unique_clicks),
    link_clicks: toNumber(row.inline_link_clicks || row.clicks),
    unique_link_clicks: toNumber(row.unique_inline_link_clicks),
    outbound_clicks: sumActionField(row.outbound_clicks),
    ctr: toNumber(row.ctr),
    unique_ctr: toNumber(row.unique_ctr),
    link_ctr: toNumber(row.inline_link_click_ctr || row.ctr),
    cpc: toNumber(row.cpc),
    cost_per_link_click: toNumber(row.cost_per_inline_link_click || row.cpc),
    cpm: toNumber(row.cpm),
    cpp: toNumber(row.cpp),
    purchases,
    leads,
    landing_page_views: landingPageViews,
    content_views: contentViews,
    add_to_cart: addToCart,
    checkouts,
    video_plays: sumActionField(row.video_play_actions),
    video_thruplays: sumActionField(row.video_thruplay_watched_actions),
    video_p25: sumActionField(row.video_p25_watched_actions),
    video_p50: sumActionField(row.video_p50_watched_actions),
    video_p75: sumActionField(row.video_p75_watched_actions),
    video_p95: sumActionField(row.video_p95_watched_actions),
    video_p100: sumActionField(row.video_p100_watched_actions),
    purchase_value: purchaseValue,
    roas,
    cost_per_purchase: purchases ? spend / purchases : 0,
    cost_per_lead: leads ? spend / leads : 0,
    cost_per_landing_page_view: actionCost(row.cost_per_action_type, ['landing_page_view']),
    cost_per_content_view: actionCost(row.cost_per_action_type, [
      'view_content',
      'omni_view_content',
      'offsite_conversion.fb_pixel_view_content',
    ]),
    cost_per_checkout: actionCost(row.cost_per_action_type, [
      'initiate_checkout',
      'offsite_conversion.fb_pixel_initiate_checkout',
      'omni_initiated_checkout',
    ]),
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
  const range = periodRange(period);
  const data = await metaGet(`${account}/insights`, {
    level: 'account',
    time_range: JSON.stringify(range),
    fields: [
      'account_id',
      'account_name',
      'account_currency',
      'spend',
      'impressions',
      'reach',
      'frequency',
      'clicks',
      'unique_clicks',
      'inline_link_clicks',
      'unique_inline_link_clicks',
      'outbound_clicks',
      'cpc',
      'cpm',
      'cpp',
      'ctr',
      'unique_ctr',
      'inline_link_click_ctr',
      'cost_per_inline_link_click',
      'actions',
      'action_values',
      'cost_per_action_type',
      'purchase_roas',
      'video_play_actions',
      'video_p25_watched_actions',
      'video_p50_watched_actions',
      'video_p75_watched_actions',
      'video_p95_watched_actions',
      'video_p100_watched_actions',
      'video_thruplay_watched_actions',
    ].join(','),
  });
  return parseInsight(data.data?.[0] || {});
}

async function loadDailyInsights(account, period) {
  const range = periodRange(period);
  const data = await metaGet(`${account}/insights`, {
    level: 'account',
    time_range: JSON.stringify(range),
    time_increment: 1,
    fields: [
      'date_start',
      'date_stop',
      'spend',
      'impressions',
      'reach',
      'frequency',
      'clicks',
      'inline_link_clicks',
      'outbound_clicks',
      'cpc',
      'cpm',
      'ctr',
      'inline_link_click_ctr',
      'actions',
      'action_values',
      'purchase_roas',
    ].join(','),
    limit: 90,
  });
  return (data.data || []).map(parseInsight);
}

async function loadCampaignInsights(account, period) {
  const range = periodRange(period);
  const data = await metaGet(`${account}/insights`, {
    level: 'campaign',
    time_range: JSON.stringify(range),
    fields: [
      'campaign_id',
      'campaign_name',
      'spend',
      'impressions',
      'reach',
      'frequency',
      'clicks',
      'unique_clicks',
      'inline_link_clicks',
      'unique_inline_link_clicks',
      'outbound_clicks',
      'cpc',
      'cpm',
      'cpp',
      'ctr',
      'unique_ctr',
      'inline_link_click_ctr',
      'cost_per_inline_link_click',
      'actions',
      'action_values',
      'cost_per_action_type',
      'purchase_roas',
      'video_play_actions',
      'video_p25_watched_actions',
      'video_p50_watched_actions',
      'video_p75_watched_actions',
      'video_p95_watched_actions',
      'video_p100_watched_actions',
      'video_thruplay_watched_actions',
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
  const dateRange = periodRange(period);

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
      date_range: dateRange,
      timezone: process.env.META_ADS_TIMEZONE || DEFAULT_TIMEZONE,
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
