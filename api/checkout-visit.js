const KITS = {
  1: { name: 'DuraLibid - 1 Frasco', price: 89.90 },
  2: { name: 'DuraLibid - 2 Frascos', price: 165.90 },
  3: { name: 'DuraLibid - 3 Frascos', price: 239.90 },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function formatMoney(value) {
  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function firstHeaderValue(value) {
  if (!value) return '';
  return String(value).split(',')[0].trim();
}

function adminEmail() {
  return process.env.ADMIN_LEADS_EMAIL || 'envios@duralibid.com.br';
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY ausente; aviso de checkout nao enviado.');
    return;
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'DuraLibid <suporte@duralibid.com.br>',
      to,
      subject,
      html,
    }),
  });

  const emailData = await emailRes.json().catch(() => ({}));
  if (!emailRes.ok) {
    console.error('Erro ao enviar aviso de checkout:', emailData);
  }
}

function renderRows(data) {
  return Object.entries(data || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `<p style="margin:4px 0;color:#C9CDD2"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`)
    .join('');
}

function checkoutVisitEmail({ kit, sourceUrl, attribution, tracking, ip, userAgent }) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#0A0A0A;color:#F5F5F5;padding:32px;border-radius:12px">
    <h1 style="color:#D9A441;font-size:24px;margin:0 0 8px">Entrada no checkout</h1>
    <p style="color:#C9CDD2;margin:0 0 24px">Um visitante abriu o checkout. Ele ainda nao informou nome, e-mail ou telefone.</p>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Kit</h3>
      <p style="margin:4px 0">${escapeHtml(kit.name)}</p>
      <p style="margin:4px 0">${formatMoney(kit.price)}</p>
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Origem</h3>
      ${renderRows({
        URL: sourceUrl,
        Referer: attribution?.referrer,
        Landing: attribution?.landing_page,
        utm_source: attribution?.utm_source,
        utm_medium: attribution?.utm_medium,
        utm_campaign: attribution?.utm_campaign,
        utm_content: attribution?.utm_content,
        utm_term: attribution?.utm_term,
        fbclid: attribution?.fbclid,
        gclid: attribution?.gclid,
        src: attribution?.src,
        sck: attribution?.sck,
      }) || '<p style="margin:4px 0;color:#C9CDD2">Sem UTM capturada.</p>'}
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Dados tecnicos</h3>
      ${renderRows({
        IP: ip,
        Navegador: userAgent,
        fbp: tracking?.fbp,
        fbc: tracking?.fbc,
        Horario: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      })}
    </div>
  </div>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { kit: kitId, sourceUrl, attribution = {}, tracking = {} } = req.body || {};
    const kit = KITS[kitId] || KITS[2];
    const ip = firstHeaderValue(req.headers['x-forwarded-for'] || req.socket?.remoteAddress);
    const userAgent = req.headers['user-agent'] || '';

    await sendEmail({
      to: adminEmail(),
      subject: `Entrada no checkout - ${kit.name}`,
      html: checkoutVisitEmail({ kit, sourceUrl, attribution, tracking, ip, userAgent }),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('checkout-visit error:', err);
    return res.status(200).json({ ok: false });
  }
}
