import { sendCapiEvent } from './capi.js';
import { updateLeadByPaymentId } from '../lib/crm.js';

const KITS = {
  1: { name: '1 Frasco — 30ml', price: 89.90,  qty: 1 },
  2: { name: '2 Frascos — 30ml cada', price: 165.90, qty: 2 },
  3: { name: '3 Frascos — 30ml cada', price: 239.90, qty: 3 },
};

// ─── Melhor Envio ────────────────────────────────────────────────────────────

async function meRequest(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.ME_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'DuraLibid/1.0 (suporte@duralibid.com.br)',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://melhorenvio.com.br/api/v2${path}`, opts);
  return res.json();
}

async function criarEtiqueta(payment) {
  const payer = payment.payer;
  const addr  = payer.address;
  const kit   = KITS[payment.metadata?.kit] || KITS[2];

  // 1. Adicionar ao carrinho
  const cartItem = await meRequest('/me/cart', 'POST', {
    from: {
      name:       'Top Sales Web',
      email:      'envios@duralibid.com.br',
      document:   '54289718000179',
      address:    'Rua Gonçalo Da Costa',
      number:     '54',
      district:   'Vila Santa Edwiges',
      city:       'São Paulo',
      state_abbr: 'SP',
      postal_code:'05104010',
      country_id: 'BR',
      phone:      '11999999999',
    },
    to: {
      name:       `${payer.first_name} ${payer.last_name}`,
      email:      payer.email,
      document:   payer.identification?.number || '',
      address:    addr.street_name,
      number:     addr.street_number,
      district:   addr.neighborhood,
      city:       addr.city,
      state_abbr: addr.federal_unit,
      postal_code: addr.zip_code?.replace(/\D/g, ''),
      country_id: 'BR',
      phone:      `${payer.phone?.area_code}${payer.phone?.number}`,
    },
    products: [{
      name:     'DuraLibid Sérum Íntimo Masculino',
      quantity:  kit.qty,
      unitary_value: kit.price / kit.qty,
      weight:   0.1,
    }],
    volumes: [{
      height: 10,
      width:  10,
      length: 10,
      weight: 0.3,
    }],
    service: 'correios-pac', // PAC por padrão — mais econômico
    options: {
      insurance_value: kit.price,
      receipt:   false,
      own_hand:  false,
      non_commercial: true,
      invoice: { key: '' },
    },
  });

  if (!cartItem?.id) return { error: 'Erro ao adicionar ao carrinho ME', detail: cartItem };

  // 2. Checkout do frete
  const checkout = await meRequest('/me/shipment/checkout', 'POST', {
    orders: [cartItem.id],
  });

  if (!checkout?.purchase?.id) return { error: 'Erro no checkout ME', detail: checkout };

  // 3. Gerar etiqueta
  const generate = await meRequest('/me/shipment/generate', 'POST', {
    orders: [cartItem.id],
  });

  // 4. Link de impressão
  const print = await meRequest('/me/shipment/print', 'POST', {
    mode: 'public',
    orders: [cartItem.id],
  });

  return {
    cartId:   cartItem.id,
    tracking: cartItem.tracking,
    printUrl: print?.url || null,
  };
}

// ─── Resend ──────────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
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
  return res.json();
}

function emailCliente({ payer, kit, tracking }) {
  return `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F5F5;padding:32px;border-radius:12px">
    <h1 style="color:#E11D26;font-size:28px;margin-bottom:8px">Pedido confirmado! 🎉</h1>
    <p style="color:#C9CDD2;margin-bottom:24px">Olá, ${payer.first_name}! Seu pagamento foi aprovado e já estamos preparando seu pedido.</p>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Seu pedido</h3>
      <p style="margin:4px 0">📦 <strong>DuraLibid — ${kit.name}</strong></p>
      <p style="margin:4px 0">💰 Valor: <strong>R$ ${kit.price.toFixed(2).replace('.', ',')}</strong></p>
      ${tracking ? `<p style="margin:4px 0">🚚 Rastreio: <strong>${tracking}</strong></p>` : ''}
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:20px">
      <h3 style="color:#D9A441;margin:0 0 12px">Endereço de entrega</h3>
      <p style="margin:4px 0;color:#C9CDD2">${payer.address.street_name}, ${payer.address.street_number}</p>
      <p style="margin:4px 0;color:#C9CDD2">${payer.address.neighborhood} — ${payer.address.city}/${payer.address.federal_unit}</p>
      <p style="margin:4px 0;color:#C9CDD2">CEP: ${payer.address.zip_code}</p>
    </div>

    <div style="background:#141518;border-radius:8px;padding:16px;margin-bottom:24px">
      <p style="margin:0;color:#8A8F98;font-size:13px">⏱ Prazo de entrega: <strong style="color:#F5F5F5">5 a 10 dias úteis</strong></p>
      <p style="margin:8px 0 0;color:#8A8F98;font-size:13px">📦 Embalagem 100% discreta, sem identificação do produto</p>
    </div>

    <p style="color:#8A8F98;font-size:12px">Dúvidas? Responda este e-mail ou acesse <a href="https://duralibid.com.br" style="color:#E11D26">duralibid.com.br</a></p>
  </div>`;
}

function emailEnvios({ payer, kit, payment, etiqueta }) {
  const addr = payer.address;
  return `
  <div style="font-family:monospace;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F5F5;padding:32px;border-radius:12px">
    <h2 style="color:#E11D26;margin-bottom:4px">🛒 NOVO PEDIDO — DuraLibid</h2>
    <p style="color:#8A8F98;margin:0 0 24px">ID: ${payment.id} · ${new Date().toLocaleString('pt-BR')}</p>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:16px">
      <h3 style="color:#D9A441;margin:0 0 12px">PRODUTO</h3>
      <p style="margin:4px 0">📦 DuraLibid — ${kit.name}</p>
      <p style="margin:4px 0">💰 R$ ${kit.price.toFixed(2).replace('.', ',')}</p>
      <p style="margin:4px 0">💳 ${payment.payment_method_id === 'pix' ? 'Pix' : 'Cartão de crédito'} ✅ Aprovado</p>
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:16px">
      <h3 style="color:#D9A441;margin:0 0 12px">CLIENTE</h3>
      <p style="margin:4px 0">👤 ${payer.first_name} ${payer.last_name}</p>
      <p style="margin:4px 0">📧 ${payer.email}</p>
      <p style="margin:4px 0">📱 (${payer.phone?.area_code}) ${payer.phone?.number}</p>
      <p style="margin:4px 0">🪪 CPF: ${payer.identification?.number}</p>
    </div>

    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:16px">
      <h3 style="color:#D9A441;margin:0 0 12px">ENDEREÇO DE ENTREGA</h3>
      <p style="margin:4px 0">${addr.street_name}, ${addr.street_number}</p>
      <p style="margin:4px 0">${addr.neighborhood} — ${addr.city}/${addr.federal_unit}</p>
      <p style="margin:4px 0">CEP: ${addr.zip_code}</p>
    </div>

    ${etiqueta?.printUrl ? `
    <div style="background:#1E2126;border-radius:8px;padding:20px;margin-bottom:16px">
      <h3 style="color:#2ecc71;margin:0 0 12px">✅ ETIQUETA GERADA</h3>
      <p style="margin:4px 0">🚚 Rastreio: <strong>${etiqueta.tracking || 'Aguardando'}</strong></p>
      <p style="margin:8px 0 0"><a href="${etiqueta.printUrl}" style="background:#E11D26;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold">🖨️ Imprimir Etiqueta</a></p>
    </div>` : `
    <div style="background:#141518;border-radius:8px;padding:16px;margin-bottom:16px">
      <p style="color:#D9A441;margin:0">⚠️ Etiqueta não gerada automaticamente. Acesse o Melhor Envio para criar manualmente.</p>
    </div>`}
  </div>`;
}

// ─── Handler principal ────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end();

  try {
    const { type, data } = req.body;
    if (type !== 'payment' || !data?.id) return res.status(200).end();

    // Buscar dados completos do pagamento no MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const payment = await mpRes.json();

    if (payment.status !== 'approved') return res.status(200).end();

    const payer = payment.payer;
    const kitId = parseInt(payment.metadata?.kit) || 2;
    const kit   = KITS[kitId] || KITS[2];

    await updateLeadByPaymentId(payment.id?.toString(), {
      funnel_status: 'paid',
      payment_status: payment.status,
      recovery_stage: 3,
      paid_at: new Date().toISOString(),
      metadata: { last_event: 'payment_approved' },
    });

    // Disparar evento Purchase na CAPI
    await sendCapiEvent({
      eventName: 'Purchase',
      eventData: {
        value: kit.price,
        currency: 'BRL',
        content_ids: [`duralibid-${kitId}frasco${kit.qty > 1 ? 's' : ''}`],
        content_type: 'product',
        num_items: kit.qty,
        order_id: payment.id.toString(),
      },
      userData: {
        email: payer.email,
        phone: `${payer.phone?.area_code}${payer.phone?.number}`,
        firstName: payer.first_name,
        lastName: payer.last_name,
        city: payer.address?.city,
        state: payer.address?.federal_unit,
        zipCode: payer.address?.zip_code,
        fbp: payment.metadata?.fbp,
        fbc: payment.metadata?.fbc,
      },
      eventSourceUrl: payment.metadata?.source_url || 'https://duralibid.com.br/checkout.html',
      eventId: `purchase_${payment.id}`,
    });

    // Tentar criar etiqueta no Melhor Envio
    let etiqueta = null;
    try {
      etiqueta = await criarEtiqueta({ ...payment, metadata: { kit: kitId } });
    } catch (e) {
      console.error('Erro Melhor Envio:', e.message);
    }

    // Enviar e-mails em paralelo
    await Promise.allSettled([
      // E-mail para envios (você)
      sendEmail({
        to: 'envios@duralibid.com.br',
        subject: `🛒 Novo pedido — ${payer.first_name} ${payer.last_name} — R$ ${kit.price.toFixed(2).replace('.', ',')}`,
        html: emailEnvios({ payer, kit, payment, etiqueta }),
      }),
      // E-mail de confirmação para o cliente
      sendEmail({
        to: payer.email,
        subject: 'Pedido confirmado — DuraLibid 🎉',
        html: emailCliente({ payer, kit, tracking: etiqueta?.tracking }),
      }),
    ]);

    console.log('Pedido processado:', payment.id, '| Kit:', kit.name, '| Etiqueta:', etiqueta?.tracking || 'manual');
    return res.status(200).end();

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).end();
  }
}
