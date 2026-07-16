import { findRecoveryCandidates, updateLeadById, updateLeadByPaymentId } from '../lib/crm.js';

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY ausente; recuperacao Pix nao enviada.');
    return false;
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
    console.error('Resend Pix recovery error:', data);
    return false;
  }
  return true;
}

async function getMercadoPagoPayment(paymentId) {
  if (!process.env.MP_ACCESS_TOKEN || !paymentId) return null;

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });

  if (!res.ok) return null;
  return res.json();
}

function nextStage(lead) {
  const startedAt = new Date(lead.pix_generated_at || lead.created_at).getTime();
  const elapsedMinutes = (Date.now() - startedAt) / 60000;
  const current = Number(lead.recovery_stage || 0);

  if (current < 1 && elapsedMinutes >= 8) return 1;
  if (current < 2 && elapsedMinutes >= 20) return 2;
  if (current < 3 && elapsedMinutes >= 35) return 3;
  return 0;
}

function checkoutUrl(lead) {
  const kit = lead.kit_id || 2;
  return `https://www.duralibid.com.br/checkout.html?kit=${encodeURIComponent(kit)}&utm_source=pix_recovery&utm_medium=email`;
}

function subjectForStage(stage) {
  if (stage === 1) return 'Seu Pix ainda esta reservado - DuraLibid';
  if (stage === 2) return 'Faltam poucos minutos para pagar seu Pix';
  return 'Precisa de ajuda para finalizar seu pedido?';
}

function emailForStage(lead, stage) {
  const name = escapeHtml((lead.name || 'cliente').split(' ')[0]);
  const title = stage === 1
    ? 'Seu Pix ainda esta reservado'
    : stage === 2
      ? 'Faltam poucos minutos'
      : 'Quer finalizar seu pedido?';
  const intro = stage === 1
    ? `Ola, ${name}. Vimos que voce gerou o Pix do seu pedido, mas o pagamento ainda nao foi confirmado.`
    : stage === 2
      ? `Ola, ${name}. Seu Pix esta perto de vencer. Para garantir o pedido, finalize o pagamento agora.`
      : `Ola, ${name}. Seu Pix pode ter vencido, mas voce ainda pode voltar ao checkout e gerar um novo codigo.`;
  const pixBlock = stage < 3 && lead.pix_code
    ? `
    <div style="background:#141518;border-radius:8px;padding:18px;margin:20px 0">
      <h3 style="color:#D9A441;margin:0 0 10px">Codigo Pix copia e cola</h3>
      <p style="word-break:break-all;color:#F5F5F5;font-size:13px;line-height:1.5;margin:0">${escapeHtml(lead.pix_code)}</p>
    </div>`
    : '';

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F5F5;padding:32px;border-radius:12px">
    <h1 style="color:#E11D26;font-size:26px;margin:0 0 8px">${title}</h1>
    <p style="color:#C9CDD2;margin:0 0 20px">${intro}</p>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Resumo do pedido</h3>
      <p style="margin:4px 0">Produto: <strong>${escapeHtml(lead.kit_name)}</strong></p>
      <p style="margin:4px 0">Valor: <strong>${formatMoney(lead.amount)}</strong></p>
    </div>

    ${pixBlock}

    <p style="margin:24px 0">
      <a href="${checkoutUrl(lead)}" style="background:#E11D26;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Finalizar pedido</a>
    </p>

    <p style="color:#8A8F98;font-size:12px;margin:0">Se voce ja pagou, pode ignorar este e-mail. A confirmacao chega automaticamente apos a aprovacao do Mercado Pago.</p>
  </div>`;
}

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return false;
  const header = req.headers.authorization || '';
  const querySecret = req.query?.secret;
  return header === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const candidates = await findRecoveryCandidates();
  const result = { checked: candidates.length, sent: 0, paid: 0, skipped: 0 };

  for (const lead of candidates) {
    const stage = nextStage(lead);
    if (!stage || !lead.email) {
      result.skipped++;
      continue;
    }

    const payment = await getMercadoPagoPayment(lead.payment_id);
    if (payment?.status === 'approved') {
      await updateLeadByPaymentId(lead.payment_id, {
        funnel_status: 'paid',
        payment_status: 'approved',
        recovery_stage: 3,
        paid_at: new Date().toISOString(),
        metadata: { last_event: 'payment_approved_by_recovery_check' },
      });
      result.paid++;
      continue;
    }

    if (payment?.status && payment.status !== 'pending') {
      await updateLeadById(lead.id, {
        funnel_status: payment.status === 'cancelled' ? 'abandoned' : 'payment_pending',
        payment_status: payment.status,
        metadata: { last_event: 'recovery_payment_status_check' },
      });
    }

    const sent = await sendEmail({
      to: lead.email,
      subject: subjectForStage(stage),
      html: emailForStage(lead, stage),
    });

    if (sent) {
      await updateLeadById(lead.id, {
        funnel_status: stage >= 3 ? 'abandoned' : 'pix_generated',
        recovery_stage: stage,
        recovery_last_sent_at: new Date().toISOString(),
        metadata: { last_event: `pix_recovery_${stage}` },
      });
      result.sent++;
    } else {
      result.skipped++;
    }
  }

  return res.status(200).json(result);
}
