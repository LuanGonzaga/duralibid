import crypto from 'crypto';

const PIXEL_ID = process.env.META_PIXEL_ID;
const TOKEN    = process.env.META_CAPI_TOKEN;

// Hash SHA-256 para dados PII (obrigatório pelo Meta)
function hash(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Envia um evento para a API de Conversões do Meta (server-side)
 * @param {string} eventName  - Ex: 'Purchase', 'InitiateCheckout', 'PageView'
 * @param {object} eventData  - Dados do evento
 * @param {object} userData   - Dados do usuário (serão hasheados)
 * @param {object} req        - Request object (para IP e user agent)
 */
export async function sendCapiEvent({ eventName, eventData = {}, userData = {}, clientIp, userAgent, eventSourceUrl }) {
  if (!PIXEL_ID || !TOKEN) return;

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: eventSourceUrl || 'https://duralibid.com.br',
      action_source: 'website',
      user_data: {
        em:  hash(userData.email),
        ph:  hash(userData.phone?.replace(/\D/g, '')),
        fn:  hash(userData.firstName),
        ln:  hash(userData.lastName),
        ct:  hash(userData.city),
        st:  hash(userData.state?.toLowerCase()),
        zp:  hash(userData.zipCode?.replace(/\D/g, '')),
        country: hash('br'),
        external_id: hash(userData.email), // ID único do usuário
        client_ip_address: clientIp || undefined,
        client_user_agent: userAgent || undefined,
      },
      custom_data: eventData,
    }],
    test_event_code: process.env.META_TEST_CODE || undefined, // para testar no Gerenciador de Eventos
  };

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) console.error('CAPI error:', data.error);
    else console.log(`CAPI ${eventName} sent:`, data.events_received);
  } catch (err) {
    console.error('CAPI fetch error:', err.message);
  }
}
