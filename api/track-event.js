import { normalizeLeadId, upsertLeadByLeadId } from '../lib/crm.js';

const KITS = {
  1: { name: 'DuraLibid - 1 Frasco', price: 89.90 },
  2: { name: 'DuraLibid - 2 Frascos', price: 165.90 },
  3: { name: 'DuraLibid - 3 Frascos', price: 239.90 },
};

const EVENT_STATUS = {
  page_view: 'site_visit',
  view_content: 'site_visit',
  cta_click: 'cta_click',
  checkout_click: 'cta_click',
  checkout_visit: 'checkout_visit',
  form_started: 'form_started',
  form_submitted: 'form_submitted',
};

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

function kitFields(kitId) {
  const id = parseInt(kitId, 10);
  const kit = KITS[id];
  if (!kit) return {};
  return {
    kit_id: id,
    kit_name: kit.name,
    amount: kit.price,
  };
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
    const eventName = cleanString(body.eventName, 80) || 'page_view';
    const funnelStatus = EVENT_STATUS[eventName] || 'site_visit';
    const ip = firstHeaderValue(req.headers['x-forwarded-for'] || req.socket?.remoteAddress);
    const userAgent = req.headers['user-agent'] || '';
    const leadId = normalizeLeadId(body.leadId || body.tracking?.leadId);
    const kitId = body.kit || body.details?.kit;
    const customer = cleanObject(body.customer);
    const address = cleanObject(body.address);
    const attribution = cleanObject(body.attribution);
    const tracking = {
      ...cleanObject(body.tracking),
      source_url: cleanString(body.sourceUrl || body.tracking?.source_url),
      last_page_type: cleanString(body.pageType || body.details?.pageType, 80),
      last_event: eventName,
      ip,
      user_agent: cleanString(userAgent, 500),
    };
    const event = {
      name: eventName,
      at: new Date().toISOString(),
      page_type: cleanString(body.pageType || body.details?.pageType, 80),
      cta_name: cleanString(body.ctaName || body.details?.ctaName, 120),
      destination: cleanString(body.destination || body.details?.destination),
      source_url: cleanString(body.sourceUrl),
      kit_id: kitId ? parseInt(kitId, 10) : undefined,
      payment_method: cleanString(body.paymentMethod || body.details?.paymentMethod, 60),
    };

    const lead = {
      lead_id: leadId,
      funnel_status: funnelStatus,
      ...kitFields(kitId),
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      cpf: customer.cpf,
      zip_code: address.zipCode,
      street: address.street,
      number: address.number,
      complement: address.complement,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      attribution,
      tracking,
      metadata: {
        last_event: eventName,
        last_page_type: event.page_type,
        last_cta: event.cta_name,
        events: [event],
      },
    };

    await upsertLeadByLeadId(lead);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('track-event error:', err);
    return res.status(200).json({ ok: false });
  }
}
