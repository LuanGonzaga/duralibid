import { shopeeAdminAuthorized, shopeeAuthUrl, shopeeConfig, shopeeSetupAuthorized } from '../lib/shopee.js';

function authorized(req) {
  return shopeeSetupAuthorized(req) || shopeeAdminAuthorized(req);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-User, X-Admin-Password');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SHOPEE_SETUP_SECRET) {
    return res.status(503).json({ error: 'SHOPEE_SETUP_SECRET nao configurada.' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const cfg = shopeeConfig();
  if (!cfg.configured || !cfg.redirectUrl) {
    return res.status(503).json({
      error: 'SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY ou SHOPEE_REDIRECT_URL nao configurada.',
    });
  }

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
