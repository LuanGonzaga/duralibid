import { sendCapiEvent } from './capi.js';
import { normalizeLeadId, upsertLeadByLeadId } from '../lib/crm.js';

const KITS = {
  1: { name: 'DuraLibid — 1 Frasco (1 mês)',    quantity: 1, price: 89.90  },
  2: { name: 'DuraLibid — 2 Frascos (2 meses)', quantity: 2, price: 165.90 },
  3: { name: 'DuraLibid — 3 Frascos (3 meses)', quantity: 3, price: 239.90 },
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

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY ausente; e-mail nao enviado.');
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
    console.error('Erro ao enviar e-mail:', emailData);
  }
}

function adminEmail() {
  return process.env.ADMIN_LEADS_EMAIL || 'envios@duralibid.com.br';
}

function paymentMethodLabel(paymentMethod) {
  return paymentMethod === 'pix' ? 'Pix' : 'Cartao de credito';
}

function renderRows(data) {
  return Object.entries(data || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `<p style="margin:4px 0;color:#C9CDD2"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`)
    .join('');
}

function emailCadastroConcluido({ order, kitData, paymentMethod, paymentId, status, trackingData }) {
  const attribution = trackingData?.attribution || {};
  const complement = order.complement
    ? `<p style="margin:4px 0;color:#C9CDD2"><strong>Complemento:</strong> ${escapeHtml(order.complement)}</p>`
    : '';

  return `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#0A0A0A;color:#F5F5F5;padding:32px;border-radius:12px">
    <h1 style="color:#D9A441;font-size:24px;margin:0 0 8px">Cadastro concluido no checkout</h1>
    <p style="color:#C9CDD2;margin:0 0 24px">O cliente preencheu os dados e gerou uma tentativa de pagamento.</p>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Pedido</h3>
      ${renderRows({
        Produto: kitData.name,
        Valor: formatMoney(kitData.price),
        Pagamento: paymentMethodLabel(paymentMethod),
        Status: status,
        'ID Mercado Pago': paymentId,
      })}
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Cliente</h3>
      ${renderRows({
        Nome: order.name,
        Email: order.email,
        Telefone: order.phone,
        CPF: order.cpf,
      })}
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Endereco</h3>
      <p style="margin:4px 0;color:#C9CDD2"><strong>Rua:</strong> ${escapeHtml(order.street)}, ${escapeHtml(order.number)}</p>
      ${complement}
      <p style="margin:4px 0;color:#C9CDD2"><strong>Bairro:</strong> ${escapeHtml(order.neighborhood)}</p>
      <p style="margin:4px 0;color:#C9CDD2"><strong>Cidade/UF:</strong> ${escapeHtml(order.city)}/${escapeHtml(order.state)}</p>
      <p style="margin:4px 0;color:#C9CDD2"><strong>CEP:</strong> ${escapeHtml(order.zipCode)}</p>
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Origem e tracking</h3>
      ${renderRows({
        URL: trackingData?.sourceUrl,
        Referer: attribution.referrer,
        Landing: attribution.landing_page,
        utm_source: attribution.utm_source,
        utm_medium: attribution.utm_medium,
        utm_campaign: attribution.utm_campaign,
        utm_content: attribution.utm_content,
        utm_term: attribution.utm_term,
        fbclid: attribution.fbclid,
        gclid: attribution.gclid,
        fbp: trackingData?.fbp,
        fbc: trackingData?.fbc,
        event_id: trackingData?.eventId,
      }) || '<p style="margin:4px 0;color:#C9CDD2">Sem origem capturada.</p>'}
    </div>
  </div>`;
}

function emailPixGerado({ order, kitData, paymentId, pixCode }) {
  const complement = order.complement
    ? `<p style="margin:4px 0;color:#C9CDD2">Complemento: ${escapeHtml(order.complement)}</p>`
    : '';

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F5F5;padding:32px;border-radius:12px">
    <h1 style="color:#E11D26;font-size:26px;margin:0 0 8px">Seu Pix foi gerado</h1>
    <p style="color:#C9CDD2;margin:0 0 24px">O pedido foi recebido e esta aguardando o pagamento via Pix.</p>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Dados do pedido</h3>
      <p style="margin:4px 0">Produto: <strong>${escapeHtml(kitData.name)}</strong></p>
      <p style="margin:4px 0">Valor: <strong>${formatMoney(kitData.price)}</strong></p>
      <p style="margin:4px 0">Forma de pagamento: <strong>Pix</strong></p>
      <p style="margin:4px 0">ID do pagamento: <strong>${escapeHtml(paymentId)}</strong></p>
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Cliente</h3>
      <p style="margin:4px 0;color:#C9CDD2">${escapeHtml(order.name)}</p>
      <p style="margin:4px 0;color:#C9CDD2">${escapeHtml(order.email)}</p>
      <p style="margin:4px 0;color:#C9CDD2">${escapeHtml(order.phone)}</p>
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Endereco de entrega</h3>
      <p style="margin:4px 0;color:#C9CDD2">${escapeHtml(order.street)}, ${escapeHtml(order.number)}</p>
      ${complement}
      <p style="margin:4px 0;color:#C9CDD2">${escapeHtml(order.neighborhood)} - ${escapeHtml(order.city)}/${escapeHtml(order.state)}</p>
      <p style="margin:4px 0;color:#C9CDD2">CEP: ${escapeHtml(order.zipCode)}</p>
    </div>

    <div style="background:#141518;border-radius:8px;padding:20px;margin-bottom:24px">
      <h3 style="color:#D9A441;margin:0 0 12px">Codigo Pix copia e cola</h3>
      <p style="word-break:break-all;color:#F5F5F5;font-size:13px;line-height:1.5;margin:0">${escapeHtml(pixCode)}</p>
      <p style="color:#8A8F98;font-size:13px;margin:16px 0 0">O Pix vence em 30 minutos. Depois do pagamento, voce recebera a confirmacao do pedido por e-mail.</p>
    </div>

    <p style="color:#8A8F98;font-size:12px;margin:0">Duvidas? Responda este e-mail ou acesse <a href="https://duralibid.com.br" style="color:#E11D26">duralibid.com.br</a></p>
  </div>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      kit, paymentMethod,
      name, email, cpf, phone,
      zipCode, street, number, complement, neighborhood, city, state,
      token, installments, issuer_id,
      tracking = {},
    } = req.body;

    const kitData = KITS[kit];
    if (!kitData) return res.status(400).json({ error: 'Kit inválido' });

    const trackingData = tracking && typeof tracking === 'object' ? tracking : {};
    const leadId = normalizeLeadId(trackingData.leadId);
    const metadata = { kit: parseInt(kit) };
    metadata.lead_id = leadId;
    if (trackingData.fbp) metadata.fbp = trackingData.fbp;
    if (trackingData.fbc) metadata.fbc = trackingData.fbc;
    if (trackingData.eventId) metadata.add_payment_info_event_id = trackingData.eventId;
    if (trackingData.sourceUrl) metadata.source_url = String(trackingData.sourceUrl).slice(0, 500);

    const payer = {
      email,
      first_name: name.split(' ')[0],
      last_name: name.split(' ').slice(1).join(' ') || name.split(' ')[0],
      identification: { type: 'CPF', number: cpf.replace(/\D/g, '') },
      phone: {
        area_code: phone.replace(/\D/g, '').slice(0, 2),
        number: phone.replace(/\D/g, '').slice(2),
      },
      address: {
        zip_code: zipCode.replace(/\D/g, ''),
        street_name: street,
        street_number: number,
        neighborhood,
        city,
        federal_unit: state,
      },
    };

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://duralibid.vercel.app';

    let payload = {
      transaction_amount: kitData.price,
      description: kitData.name,
      payer,
      metadata,
      notification_url: `${baseUrl}/api/webhook`,
    };

    if (paymentMethod === 'pix') {
      payload.payment_method_id = 'pix';
      payload.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    } else {
      payload.payment_method_id = 'credit_card';
      payload.token = token;
      payload.installments = parseInt(installments) || 1;
      if (issuer_id) payload.issuer_id = issuer_id;
    }

    // Disparar evento AddPaymentInfo na CAPI
    await sendCapiEvent({
      eventName: 'AddPaymentInfo',
      eventData: {
        content_name: kitData.name,
        value: kitData.price,
        currency: 'BRL',
        content_ids: [`duralibid-${kit}frasco${kitData.quantity > 1 ? 's' : ''}`],
        content_type: 'product',
        num_items: kitData.quantity,
        payment_method: paymentMethod,
      },
      userData: {
        email: email,
        phone: phone,
        firstName: name.split(' ')[0],
        lastName: name.split(' ').slice(1).join(' '),
        city: city,
        state: state,
        zipCode: zipCode,
        fbp: trackingData.fbp,
        fbc: trackingData.fbc,
      },
      clientIp: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
      eventSourceUrl: trackingData.sourceUrl || 'https://duralibid.com.br/checkout.html',
      eventId: trackingData.eventId,
    });

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `${Date.now()}-${Math.random()}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await mpRes.json();

    if (mpRes.ok) {
      const order = { name, email, cpf, phone, zipCode, street, number, complement, neighborhood, city, state };
      const pixCode = data.point_of_interaction?.transaction_data?.qr_code;
      const pixExpiresAt = paymentMethod === 'pix'
        ? payload.date_of_expiration
        : null;

      await upsertLeadByLeadId({
        lead_id: leadId,
        funnel_status: paymentMethod === 'pix'
          ? 'pix_generated'
          : (data.status === 'approved' ? 'paid' : 'payment_pending'),
        payment_status: data.status,
        payment_method: paymentMethod,
        payment_id: data.id?.toString(),
        kit_id: parseInt(kit, 10),
        kit_name: kitData.name,
        amount: kitData.price,
        name,
        email,
        phone,
        cpf,
        zip_code: zipCode,
        street,
        number,
        complement,
        neighborhood,
        city,
        state,
        pix_code: pixCode,
        pix_generated_at: paymentMethod === 'pix' ? new Date().toISOString() : null,
        pix_expires_at: pixExpiresAt,
        recovery_stage: 0,
        attribution: trackingData.attribution || {},
        tracking: {
          fbp: trackingData.fbp,
          fbc: trackingData.fbc,
          event_id: trackingData.eventId,
          source_url: trackingData.sourceUrl,
        },
        metadata: { last_event: 'payment_created', status_detail: data.status_detail },
      });

      const adminLeadEmail = sendEmail({
        to: adminEmail(),
        subject: `Cadastro concluido - ${name} - ${formatMoney(kitData.price)}`,
        html: emailCadastroConcluido({
          order,
          kitData,
          paymentMethod,
          paymentId: data.id,
          status: data.status,
          trackingData,
        }),
      }).catch((emailErr) => {
        console.error('Falha ao enviar e-mail de cadastro concluido:', emailErr);
      });

      if (paymentMethod === 'pix') {
        await Promise.allSettled([
          adminLeadEmail,
          sendEmail({
            to: email,
            subject: 'Seu Pix foi gerado - DuraLibid',
            html: emailPixGerado({
              order,
              kitData,
              paymentId: data.id,
              pixCode,
            }),
          }).catch((emailErr) => {
            console.error('Falha ao enviar e-mail de Pix gerado:', emailErr);
          }),
        ]);

        return res.status(200).json({
          status: data.status,
          payment_id: data.id,
          pix_copy_paste: pixCode,
          pix_qr_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
        });
      } else {
        await adminLeadEmail;

        return res.status(200).json({
          status: data.status,
          payment_id: data.id,
          status_detail: data.status_detail,
        });
      }
    }

    return res.status(400).json({
      error: data.message || 'Erro ao processar pagamento',
      detail: data,
    });

  } catch (err) {
    console.error('create-payment error:', err);
    return res.status(500).json({ error: 'Erro interno do servidor', message: err.message });
  }
}
