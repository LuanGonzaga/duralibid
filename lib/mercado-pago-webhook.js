import crypto from 'node:crypto';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || '').toLowerCase());
  const b = Buffer.from(String(right || '').toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signatureParts(header) {
  return String(header || '').split(',').reduce((acc, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return acc;
    acc[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
    return acc;
  }, {});
}

export function mercadoPagoWebhookSecretConfigured() {
  return Boolean(String(process.env.MP_WEBHOOK_SECRET || '').trim());
}

export function verifyMercadoPagoWebhook(req) {
  const secret = String(process.env.MP_WEBHOOK_SECRET || '').trim();
  if (!secret) return { valid: true, enforced: false, reason: 'secret_not_configured' };

  const dataId = String(req.body?.data?.id || req.query?.['data.id'] || '').toLowerCase();
  const requestId = String(req.headers['x-request-id'] || '').trim();
  const { ts, v1 } = signatureParts(req.headers['x-signature']);
  if (!dataId || !requestId || !ts || !v1) {
    return { valid: false, enforced: true, reason: 'missing_signature_fields' };
  }

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return {
    valid: safeEqual(expected, v1),
    enforced: true,
    reason: safeEqual(expected, v1) ? 'valid' : 'signature_mismatch',
  };
}

