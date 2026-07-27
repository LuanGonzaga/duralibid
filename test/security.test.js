import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  adminAuthorized,
  clearAdminSession,
  sameOriginMutation,
  setAdminSession,
  verifyAdminCredentials,
} from '../lib/admin-auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { verifyMercadoPagoWebhook } from '../lib/mercado-pago-webhook.js';
import leadsHandler from '../api/leads.js';

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

test('admin session uses a secure HttpOnly cookie and validates it', () => {
  process.env.ADMIN_PANEL_USER = 'admin-test';
  process.env.ADMIN_PANEL_PASSWORD = 'password-test';
  process.env.ADMIN_SESSION_SECRET = 'session-secret-test';

  assert.equal(verifyAdminCredentials('admin-test', 'password-test'), true);
  assert.equal(verifyAdminCredentials('admin-test', 'wrong'), false);

  const res = response();
  setAdminSession(res, 'admin-test');
  const setCookie = res.headers['Set-Cookie'][0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);

  const cookie = setCookie.split(';')[0];
  assert.equal(adminAuthorized({ headers: { cookie } }), true);

  clearAdminSession(res);
  assert.match(res.headers['Set-Cookie'][0], /Max-Age=0/);
});

test('leads API exchanges credentials for a server-side session cookie', async () => {
  process.env.ADMIN_PANEL_USER = 'panel-user';
  process.env.ADMIN_PANEL_PASSWORD = 'panel-password';
  process.env.ADMIN_SESSION_SECRET = 'panel-session-secret';

  const loginRes = response();
  await leadsHandler({
    method: 'POST',
    body: { action: 'login', user: 'panel-user', password: 'panel-password' },
    query: {},
    headers: { 'x-forwarded-for': '203.0.113.55' },
    socket: {},
  }, loginRes);
  assert.equal(loginRes.statusCode, 200);
  assert.equal(loginRes.body.user, 'panel-user');

  const sessionRes = response();
  await leadsHandler({
    method: 'GET',
    body: {},
    query: { action: 'session' },
    headers: { cookie: loginRes.headers['Set-Cookie'][0].split(';')[0] },
    socket: {},
  }, sessionRes);
  assert.equal(sessionRes.statusCode, 200);
  assert.equal(sessionRes.body.user, 'panel-user');
});

test('admin mutations reject cross-site browser requests', () => {
  assert.equal(sameOriginMutation({
    headers: {
      origin: 'https://www.duralibid.com.br',
      host: 'www.duralibid.com.br',
      'sec-fetch-site': 'same-origin',
    },
  }), true);
  assert.equal(sameOriginMutation({
    headers: {
      origin: 'https://attacker.example',
      host: 'www.duralibid.com.br',
      'sec-fetch-site': 'cross-site',
    },
  }), false);
});

test('Mercado Pago signature is verified using the official manifest', () => {
  process.env.MP_WEBHOOK_SECRET = 'mp-secret-test';
  const ts = '1704908010';
  const requestId = 'request-123';
  const dataId = '999999999';
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const signature = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');
  const req = {
    body: { data: { id: dataId } },
    query: {},
    headers: {
      'x-request-id': requestId,
      'x-signature': `ts=${ts},v1=${signature}`,
    },
  };

  assert.equal(verifyMercadoPagoWebhook(req).valid, true);
  req.headers['x-signature'] = `ts=${ts},v1=invalid`;
  assert.equal(verifyMercadoPagoWebhook(req).valid, false);
});

test('rate limiter blocks requests above the configured limit', () => {
  const req = {
    headers: { 'x-forwarded-for': '203.0.113.42' },
    socket: {},
  };
  const first = response();
  const second = response();
  const third = response();
  const options = { namespace: `test-${Date.now()}`, limit: 2, windowMs: 60_000 };

  assert.equal(enforceRateLimit(req, first, options), true);
  assert.equal(enforceRateLimit(req, second, options), true);
  assert.equal(enforceRateLimit(req, third, options), false);
  assert.equal(third.statusCode, 429);
});
