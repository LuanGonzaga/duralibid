import {
  exchangeShopeeCode,
  refreshShopeeAccessToken,
  shopeeAdminAuthorized,
  shopeeAuthUrl,
  shopeeConfig,
  shopeeSetupAuthorized,
} from '../lib/shopee.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function authorized(req, callbackOnly = false) {
  if (shopeeSetupAuthorized(req)) return true;
  return callbackOnly ? false : shopeeAdminAuthorized(req);
}

function tokenPage({ shopId, data }) {
  const expiresIn = Number(data.expire_in || data.expires_in || 0);
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : '';
  const envBlock = [
    `SHOPEE_SHOP_ID=${shopId}`,
    `SHOPEE_ACCESS_TOKEN=${data.access_token || ''}`,
    `SHOPEE_REFRESH_TOKEN=${data.refresh_token || ''}`,
    expiresAt ? `SHOPEE_ACCESS_TOKEN_EXPIRES_AT=${expiresAt}` : '',
  ].filter(Boolean).join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shopee conectada</title>
  <style>
    body{margin:0;background:#0a0a0a;color:#f5f5f5;font-family:Arial,sans-serif;line-height:1.5}
    main{max-width:820px;margin:0 auto;padding:40px 20px}
    h1{margin:0 0 12px;font-size:28px}
    p{color:#c9cdd2}
    pre{white-space:pre-wrap;word-break:break-all;background:#14171c;border:1px solid #2a2e34;border-radius:10px;padding:18px;color:#fff}
    .ok{color:#2ecc71;font-weight:700}
    .warn{color:#d9a441;font-weight:700}
  </style>
</head>
<body>
  <main>
    <p class="ok">Shopee autorizada com sucesso.</p>
    <h1>Tokens gerados</h1>
    <p>Copie estas variaveis para a Vercel em Production. O access token expira rapido; o refresh token e o valor mais importante para manter a integracao.</p>
    <pre>${escapeHtml(envBlock)}</pre>
    <p class="warn">Nao compartilhe esta tela. Depois que salvar as variaveis, feche esta aba.</p>
  </main>
</body>
</html>`;
}

function ensureSetup(req, res, callbackOnly = false) {
  if (!process.env.SHOPEE_SETUP_SECRET) {
    res.status(503).json({ error: 'SHOPEE_SETUP_SECRET nao configurada.' });
    return false;
  }
  if (!authorized(req, callbackOnly)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function ensureShopeeConfig(res, requireRedirect = false) {
  const cfg = shopeeConfig();
  if (!cfg.configured || (requireRedirect && !cfg.redirectUrl)) {
    res.status(503).json({
      error: requireRedirect
        ? 'SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY ou SHOPEE_REDIRECT_URL nao configurada.'
        : 'SHOPEE_PARTNER_ID ou SHOPEE_PARTNER_KEY nao configurada.',
    });
    return null;
  }
  return cfg;
}

async function handleAuth(req, res) {
  if (!ensureSetup(req, res)) return;
  const cfg = ensureShopeeConfig(res, true);
  if (!cfg) return;

  const authUrl = shopeeAuthUrl();
  if (String(req.query?.redirect || '') === '1') {
    res.writeHead(302, { Location: authUrl });
    return res.end();
  }

  return res.status(200).json({
    ok: true,
    authUrl,
    redirectUrl: cfg.redirectUrl,
    note: 'Abra authUrl em ate alguns minutos, faca login na Shopee e autorize a loja.',
  });
}

async function handleCallback(req, res) {
  if (!ensureSetup(req, res, true)) return;
  if (!ensureShopeeConfig(res)) return;

  const code = String(req.query?.code || '').trim();
  const shopId = String(req.query?.shop_id || req.query?.shopId || '').trim();
  if (!code || !shopId) {
    return res.status(400).json({ error: 'Callback sem code ou shop_id.', query: req.query || {} });
  }

  try {
    const data = await exchangeShopeeCode({ code, shopId });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(tokenPage({ shopId, data }));
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Erro ao trocar code por token.',
      details: err.data || undefined,
    });
  }
}

async function handleRefresh(req, res) {
  if (!ensureSetup(req, res)) return;
  if (!ensureShopeeConfig(res)) return;

  const body = req.body || {};
  const shopId = String(body.shop_id || body.shopId || req.query?.shop_id || process.env.SHOPEE_SHOP_ID || '').trim();
  const refreshToken = String(body.refresh_token || body.refreshToken || process.env.SHOPEE_REFRESH_TOKEN || '').trim();
  if (!shopId || !refreshToken) {
    return res.status(400).json({ error: 'SHOPEE_SHOP_ID ou SHOPEE_REFRESH_TOKEN ausente.' });
  }

  try {
    const data = await refreshShopeeAccessToken({ refreshToken, shopId });
    const expiresIn = Number(data.expire_in || data.expires_in || 0);
    return res.status(200).json({
      ok: true,
      shop_id: shopId,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expire_in: expiresIn || undefined,
      access_token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
      request_id: data.request_id,
      note: 'Atualize SHOPEE_ACCESS_TOKEN e SHOPEE_REFRESH_TOKEN na Vercel. O refresh token da Shopee e de uso unico.',
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Erro ao renovar token Shopee.',
      details: err.data || undefined,
    });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-User, X-Admin-Password');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = String(req.query?.action || '').trim().toLowerCase();
  if (action === 'auth') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    return handleAuth(req, res);
  }
  if (action === 'callback') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    return handleCallback(req, res);
  }
  if (action === 'refresh') {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    return handleRefresh(req, res);
  }

  return res.status(400).json({
    error: 'Acao invalida. Use action=auth, action=callback ou action=refresh.',
  });
}
