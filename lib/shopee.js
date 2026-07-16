import crypto from 'node:crypto';

const DEFAULT_HOST = 'https://partner.shopeemobile.com';

export function shopeeConfig() {
  const partnerId = String(process.env.SHOPEE_PARTNER_ID || '').trim();
  const partnerKey = String(process.env.SHOPEE_PARTNER_KEY || '').trim();
  const redirectUrl = String(process.env.SHOPEE_REDIRECT_URL || '').trim();
  const host = String(process.env.SHOPEE_HOST || DEFAULT_HOST).trim().replace(/\/$/, '');

  return {
    configured: Boolean(partnerId && partnerKey),
    partnerId,
    partnerIdNumber: Number(partnerId),
    partnerKey,
    redirectUrl,
    host,
  };
}

export function shopeeSetupAuthorized(req) {
  const setupSecret = String(process.env.SHOPEE_SETUP_SECRET || '').trim();
  if (!setupSecret) return false;
  return String(req.query?.secret || '') === setupSecret;
}

export function shopeeAdminAuthorized(req) {
  const user = process.env.ADMIN_PANEL_USER;
  const password = process.env.ADMIN_PANEL_PASSWORD;
  if (!user || !password) return false;
  return req.headers['x-admin-user'] === user && req.headers['x-admin-password'] === password;
}

export function shopeeSign({ path, timestamp, accessToken = '', shopId = '' }) {
  const cfg = shopeeConfig();
  const baseString = `${cfg.partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', cfg.partnerKey).update(baseString).digest('hex');
}

export function shopeeAuthUrl() {
  const cfg = shopeeConfig();
  const path = '/api/v2/shop/auth_partner';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = shopeeSign({ path, timestamp });
  const url = new URL(`${cfg.host}${path}`);
  url.searchParams.set('partner_id', cfg.partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  url.searchParams.set('redirect', cfg.redirectUrl);
  return url.toString();
}

async function shopeePostPublic(path, body) {
  const cfg = shopeeConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = shopeeSign({ path, timestamp });
  const url = new URL(`${cfg.host}${path}`);
  url.searchParams.set('partner_id', cfg.partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partner_id: cfg.partnerIdNumber,
      ...body,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data.message || data.msg || data.error || `Shopee HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function exchangeShopeeCode({ code, shopId }) {
  return shopeePostPublic('/api/v2/auth/token/get', {
    code: String(code || '').trim(),
    shop_id: Number(shopId),
  });
}

export function refreshShopeeAccessToken({ refreshToken, shopId }) {
  return shopeePostPublic('/api/v2/auth/access_token/get', {
    refresh_token: String(refreshToken || '').trim(),
    shop_id: Number(shopId),
  });
}
