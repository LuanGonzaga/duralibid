const https = require('https');

const KITS = {
  1: { name: 'DuraLibid — 1 Frasco (1 mês)',      quantity: 1, price: 89.90  },
  2: { name: 'DuraLibid — 2 Frascos (2 meses)',   quantity: 2, price: 165.90 },
  3: { name: 'DuraLibid — 3 Frascos (3 meses)',   quantity: 3, price: 239.90 },
};

function mpRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.mercadopago.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-Idempotency-Key': `${Date.now()}-${Math.random()}`,
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      kit,
      paymentMethod, // 'pix' | 'credit_card'
      // dados pessoais
      name, email, cpf, phone,
      // endereço
      zipCode, street, number, complement, neighborhood, city, state,
      // cartão (apenas se paymentMethod === 'credit_card')
      token, installments, issuer_id,
    } = req.body;

    const kitData = KITS[kit];
    if (!kitData) return res.status(400).json({ error: 'Kit inválido' });

    const payer = {
      email,
      first_name: name.split(' ')[0],
      last_name: name.split(' ').slice(1).join(' ') || name.split(' ')[0],
      identification: { type: 'CPF', number: cpf.replace(/\D/g, '') },
      phone: { area_code: phone.replace(/\D/g, '').slice(0, 2), number: phone.replace(/\D/g, '').slice(2) },
      address: {
        zip_code: zipCode.replace(/\D/g, ''),
        street_name: street,
        street_number: number,
        neighborhood,
        city,
        federal_unit: state,
      },
    };

    let payload = {
      transaction_amount: kitData.price,
      description: kitData.name,
      payer,
      notification_url: `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''}/api/webhook`,
    };

    if (paymentMethod === 'pix') {
      payload.payment_method_id = 'pix';
      payload.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30min
    } else {
      payload.payment_method_id = 'credit_card';
      payload.token = token;
      payload.installments = parseInt(installments) || 1;
      payload.issuer_id = issuer_id;
    }

    const result = await mpRequest('/v1/payments', payload);

    if (result.status === 201) {
      const p = result.body;
      if (paymentMethod === 'pix') {
        return res.status(200).json({
          status: p.status,
          payment_id: p.id,
          pix_copy_paste: p.point_of_interaction?.transaction_data?.qr_code,
          pix_qr_base64: p.point_of_interaction?.transaction_data?.qr_code_base64,
        });
      } else {
        return res.status(200).json({
          status: p.status,
          payment_id: p.id,
          status_detail: p.status_detail,
        });
      }
    }

    return res.status(400).json({ error: result.body.message || 'Erro ao processar pagamento', detail: result.body });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
