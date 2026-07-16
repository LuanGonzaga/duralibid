import { refreshShopeeAccessToken, shopeeAdminAuthorized, shopeeConfig, shopeeSetupAuthorized } from '../lib/shopee.js';

function authorized(req) {
  return shopeeSetupAuthorized(req) || shopeeAdminAuthorized(req);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-User, X-Admin-Password');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SHOPEE_SETUP_SECRET) {
    return res.status(503).json({ error: 'SHOPEE_SETUP_SECRET nao configurada.' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const cfg = shopeeConfig();
  if (!cfg.configured) {
    return res.status(503).json({ error: 'SHOPEE_PARTNER_ID ou SHOPEE_PARTNER_KEY nao configurada.' });
  }

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
