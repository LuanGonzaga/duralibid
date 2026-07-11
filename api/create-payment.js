import { sendCapiEvent } from './capi.js';

const KITS = {
  1: { name: 'DuraLibid — 1 Frasco (1 mês)',    quantity: 1, price: 89.90  },
  2: { name: 'DuraLibid — 2 Frascos (2 meses)', quantity: 2, price: 165.90 },
  3: { name: 'DuraLibid — 3 Frascos (3 meses)', quantity: 3, price: 239.90 },
};

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
    } = req.body;

    const kitData = KITS[kit];
    if (!kitData) return res.status(400).json({ error: 'Kit inválido' });

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
      metadata: { kit: parseInt(kit) },
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

    // Disparar evento InitiateCheckout na CAPI
    await sendCapiEvent({
      eventName: 'InitiateCheckout',
      eventData: {
        value: kitData.price,
        currency: 'BRL',
        content_ids: [`duralibid-${kit}frasco`],
        content_type: 'product',
        num_items: kitData.quantity,
      },
      userData: {
        email: email,
        phone: phone,
        firstName: name.split(' ')[0],
        lastName: name.split(' ').slice(1).join(' '),
        city: city,
        state: state,
        zipCode: zipCode,
      },
      clientIp: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
      eventSourceUrl: 'https://duralibid.com.br/checkout.html',
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
      if (paymentMethod === 'pix') {
        return res.status(200).json({
          status: data.status,
          payment_id: data.id,
          pix_copy_paste: data.point_of_interaction?.transaction_data?.qr_code,
          pix_qr_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
        });
      } else {
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
