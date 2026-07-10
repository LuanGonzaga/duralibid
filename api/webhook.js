const https = require('https');

function mpGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.mercadopago.com',
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end();

  try {
    const { type, data } = req.body;

    if (type === 'payment' && data?.id) {
      const payment = await mpGet(`/v1/payments/${data.id}`);

      if (payment.status === 'approved') {
        // Aqui você pode:
        // 1. Enviar e-mail de confirmação do pedido
        // 2. Salvar pedido em banco de dados
        // 3. Notificar sistema de expedição
        console.log('Pagamento aprovado:', {
          id: payment.id,
          amount: payment.transaction_amount,
          payer: payment.payer,
          description: payment.description,
        });
      }
    }

    return res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).end(); // sempre 200 pro MP não retentar
  }
};
