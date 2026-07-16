import { exchangeShopeeCode, shopeeConfig, shopeeSetupAuthorized } from '../lib/shopee.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function tokenPage({ shopId, data }) {
  const expiresIn = Number(data.expire_in || data.expires_in || 0);
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : '';
  const refreshToken = data.refresh_token || '';
  const accessToken = data.access_token || '';
  const envBlock = [
    `SHOPEE_SHOP_ID=${shopId}`,
    `SHOPEE_ACCESS_TOKEN=${accessToken}`,
    `SHOPEE_REFRESH_TOKEN=${refreshToken}`,
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SHOPEE_SETUP_SECRET) {
    return res.status(503).json({ error: 'SHOPEE_SETUP_SECRET nao configurada.' });
  }
  if (!shopeeSetupAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const cfg = shopeeConfig();
  if (!cfg.configured) {
    return res.status(503).json({ error: 'SHOPEE_PARTNER_ID ou SHOPEE_PARTNER_KEY nao configurada.' });
  }

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
