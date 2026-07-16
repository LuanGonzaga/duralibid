import { sendCapiEvent } from './capi.js';
import { normalizeLeadId, upsertLeadByLeadId } from '../lib/crm.js';

const COUPON_CODE = 'DURA5';
const DISCOUNT_PERCENT = 5;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function firstHeaderValue(value) {
  if (!value) return '';
  return String(value).split(',')[0].trim();
}

function cleanString(value, max = 500) {
  if (value == null) return undefined;
  return String(value).slice(0, max);
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, item]) => {
    if (item == null || item === '') return acc;
    if (typeof item === 'object') return acc;
    acc[key] = cleanString(item);
    return acc;
  }, {});
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function couponLink() {
  const params = new URLSearchParams({
    kit: '2',
    coupon: COUPON_CODE,
    utm_source: 'coupon',
    utm_medium: 'email',
    utm_campaign: 'dura5_popup',
  });
  return `https://www.duralibid.com.br/checkout.html?${params.toString()}`;
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY ausente; cupom nao enviado.');
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'DuraLibid <suporte@duralibid.com.br>',
      to,
      subject,
      html,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Erro ao enviar cupom:', data);
  }
}

function couponEmail({ email }) {
  const link = couponLink();
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#0A0A0A;color:#F5F5F5;padding:32px;border-radius:12px">
    <p style="margin:0 0 8px;color:#D9A441;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Cupom exclusivo DuraLibid</p>
    <h1 style="color:#F5F5F5;font-size:28px;margin:0 0 12px">Seu cupom esta liberado</h1>
    <p style="color:#C9CDD2;font-size:16px;line-height:1.6;margin:0 0 24px">Use o codigo abaixo no checkout para receber ${DISCOUNT_PERCENT}% de desconto no seu pedido.</p>

    <div style="background:#1E2126;border:1px solid #2A2E34;border-radius:10px;padding:22px;text-align:center;margin-bottom:22px">
      <p style="color:#8A8F98;font-size:12px;text-transform:uppercase;letter-spacing:.12em;margin:0 0 8px">Seu codigo</p>
      <div style="font-size:34px;letter-spacing:.18em;color:#E11D26;font-weight:800;margin-bottom:14px">${COUPON_CODE}</div>
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#E11D26;color:#fff;text-decoration:none;border-radius:999px;padding:14px 24px;font-weight:800;text-transform:uppercase">Usar cupom agora</a>
    </div>

    <p style="color:#C9CDD2;font-size:14px;line-height:1.6;margin:0 0 18px">O desconto e aplicado automaticamente pelo link acima. Se preferir, acesse o site e digite o codigo <strong>${COUPON_CODE}</strong> no campo de cupom.</p>
    <p style="color:#8A8F98;font-size:12px;margin:0">Enviado para ${escapeHtml(email)}. Duvidas? Responda este e-mail.</p>
  </div>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!validEmail(email)) return res.status(400).json({ error: 'E-mail invalido.' });

    const ip = firstHeaderValue(req.headers['x-forwarded-for'] || req.socket?.remoteAddress);
    const userAgent = req.headers['user-agent'] || '';
    const leadId = normalizeLeadId(body.leadId || body.tracking?.leadId);
    const tracking = cleanObject(body.tracking);
    const attribution = cleanObject(body.attribution);
    const sourceUrl = cleanString(body.sourceUrl || tracking.source_url) || 'https://duralibid.com.br';
    const eventId = cleanString(body.eventId || tracking.eventId || tracking.event_id, 160);

    await upsertLeadByLeadId({
      lead_id: leadId,
      funnel_status: 'coupon_requested',
      email,
      attribution,
      tracking: {
        ...tracking,
        source_url: sourceUrl,
        event_id: eventId,
        last_event: 'coupon_requested',
        ip,
        user_agent: cleanString(userAgent, 500),
      },
      metadata: {
        last_event: 'coupon_requested',
        coupon_code: COUPON_CODE,
        coupon_discount_percent: DISCOUNT_PERCENT,
        events: [{
          name: 'coupon_requested',
          at: new Date().toISOString(),
          event_id: eventId,
          source_url: sourceUrl,
        }],
      },
    });

    await Promise.allSettled([
      sendEmail({
        to: email,
        subject: 'Seu cupom DuraLibid esta aqui',
        html: couponEmail({ email }),
      }),
      sendCapiEvent({
        eventName: 'Lead',
        eventData: {
          content_name: 'Cupom DuraLibid',
          lead_type: 'coupon',
          coupon_code: COUPON_CODE,
          currency: 'BRL',
          value: 0,
        },
        userData: {
          email,
          fbp: tracking.fbp,
          fbc: tracking.fbc,
        },
        clientIp: ip,
        userAgent,
        eventSourceUrl: sourceUrl,
        eventId,
      }),
    ]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead-coupon error:', err);
    return res.status(500).json({ error: 'Erro ao enviar cupom.' });
  }
}
