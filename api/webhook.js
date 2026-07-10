export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end();

  try {
    const { type, data } = req.body;

    if (type === 'payment' && data?.id) {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
        headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` },
      });
      const payment = await mpRes.json();

      if (payment.status === 'approved') {
        console.log('Pagamento aprovado:', {
          id: payment.id,
          amount: payment.transaction_amount,
          email: payment.payer?.email,
          description: payment.description,
        });
        // Aqui futuramente: enviar e-mail, salvar no banco, etc.
      }
    }

    return res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).end();
  }
}
