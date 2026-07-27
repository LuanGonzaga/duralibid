import crypto from 'node:crypto';

const COOKIE_NAME = 'dl_admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secret() {
  const configured = String(process.env.ADMIN_SESSION_SECRET || '').trim();
  if (configured) return configured;
  return `${process.env.ADMIN_PANEL_USER || ''}:${process.env.ADMIN_PANEL_PASSWORD || ''}:duralibid-admin-v1`;
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function cookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((acc, entry) => {
    const separator = entry.indexOf('=');
    if (separator < 0) return acc;
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (key) acc[key] = value;
    return acc;
  }, {});
}

function sessionFromRequest(req) {
  const token = cookies(req)[COOKIE_NAME];
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.user || !session.expiresAt || session.expiresAt <= Date.now()) return null;
    if (!safeEqual(session.user, process.env.ADMIN_PANEL_USER)) return null;
    return session;
  } catch {
    return null;
  }
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PANEL_USER && process.env.ADMIN_PANEL_PASSWORD);
}

export function verifyAdminCredentials(user, password) {
  if (!adminConfigured()) return false;
  return safeEqual(user, process.env.ADMIN_PANEL_USER)
    && safeEqual(password, process.env.ADMIN_PANEL_PASSWORD);
}

export function adminSession(req) {
  const session = sessionFromRequest(req);
  if (session) return session;

  // Compatibilidade temporária para integrações administrativas existentes.
  if (verifyAdminCredentials(req.headers['x-admin-user'], req.headers['x-admin-password'])) {
    return { user: process.env.ADMIN_PANEL_USER, legacy: true };
  }
  return null;
}

export function adminAuthorized(req) {
  return Boolean(adminSession(req));
}

export function setAdminSession(res, user) {
  const payload = encode(JSON.stringify({
    user,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  }));
  const token = `${payload}.${sign(payload)}`;
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
  ]);
}

export function clearAdminSession(res) {
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
  ]);
}

export function sameOriginMutation(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;

  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return Boolean(requestHost && originHost === requestHost);
  } catch {
    return false;
  }
}

