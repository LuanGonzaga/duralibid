const TABLE = 'leads';
const STATUS_RANK = {
  site_visit: 10,
  cta_click: 20,
  coupon_requested: 25,
  checkout_visit: 30,
  form_started: 40,
  form_submitted: 50,
  x1_contacted: 52,
  x1_qualified: 55,
  x1_offer_sent: 58,
  pix_generated: 60,
  x1_payment_sent: 62,
  payment_pending: 65,
  x1_lost: 70,
  abandoned: 70,
  paid: 80,
};

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return {
    baseUrl: `${url.replace(/\/$/, '')}/rest/v1/${TABLE}`,
    key,
  };
}

function headers(extra = {}) {
  const cfg = config();
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function statusRank(status) {
  return STATUS_RANK[status] || 0;
}

function bestStatus(currentStatus, nextStatus) {
  if (String(currentStatus || '').startsWith('x1_')
    && ['pix_generated', 'payment_pending', 'paid'].includes(nextStatus)) {
    return nextStatus;
  }
  return statusRank(nextStatus) >= statusRank(currentStatus) ? nextStatus : currentStatus;
}

function compactObject(value) {
  return Object.entries(value || {}).reduce((acc, [key, item]) => {
    if (item !== undefined) acc[key] = item;
    return acc;
  }, {});
}

function mergeJsonObject(current, next) {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const patch = next && typeof next === 'object' && !Array.isArray(next) ? next : {};
  return compactObject({ ...base, ...patch });
}

function mergeMetadata(current, next) {
  const merged = mergeJsonObject(current, next);
  const currentEvents = Array.isArray(current?.events) ? current.events : [];
  const nextEvents = Array.isArray(next?.events) ? next.events : [];
  if (currentEvents.length || nextEvents.length) {
    merged.events = currentEvents.concat(nextEvents).slice(-60);
  }
  return merged;
}

export function normalizeLeadId(value) {
  if (!value) return `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return String(value).slice(0, 120);
}

export async function getLeadByLeadId(leadId) {
  const cfg = config();
  if (!cfg || !leadId) return null;

  const params = new URLSearchParams({
    select: '*',
    lead_id: `eq.${leadId}`,
    limit: '1',
  });

  const res = await fetch(`${cfg.baseUrl}?${params.toString()}`, {
    headers: headers(),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('CRM get lead error:', data);
    return null;
  }
  return Array.isArray(data) ? data[0] : null;
}

export async function getLeadById(id) {
  const cfg = config();
  if (!cfg || !id) return null;

  const params = new URLSearchParams({
    select: '*',
    id: `eq.${id}`,
    limit: '1',
  });
  const res = await fetch(`${cfg.baseUrl}?${params.toString()}`, { headers: headers() });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('CRM get id error:', data);
    return null;
  }
  return Array.isArray(data) ? data[0] : null;
}

export async function getLeadByPaymentId(paymentId) {
  const cfg = config();
  if (!cfg || !paymentId) return null;

  const params = new URLSearchParams({
    select: '*',
    payment_id: `eq.${paymentId}`,
    limit: '1',
  });
  const res = await fetch(`${cfg.baseUrl}?${params.toString()}`, { headers: headers() });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('CRM get payment error:', data);
    return null;
  }
  return Array.isArray(data) ? data[0] : null;
}

export async function upsertLeadByLeadId(lead) {
  const cfg = config();
  if (!cfg) return null;

  const leadId = normalizeLeadId(lead.lead_id);
  const existing = await getLeadByLeadId(leadId);
  const chosenStatus = bestStatus(existing?.funnel_status, lead.funnel_status || existing?.funnel_status || 'checkout_visit');
  const payload = compactObject({
    ...lead,
    lead_id: leadId,
    funnel_status: chosenStatus,
    updated_at: new Date().toISOString(),
    last_event_at: new Date().toISOString(),
  });

  if (existing) {
    if (lead.attribution) payload.attribution = mergeJsonObject(existing.attribution, lead.attribution);
    if (lead.tracking) payload.tracking = mergeJsonObject(existing.tracking, lead.tracking);
    if (lead.metadata) payload.metadata = mergeMetadata(existing.metadata, lead.metadata);
  }

  const res = await fetch(`${cfg.baseUrl}?on_conflict=lead_id`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('CRM upsert error:', data);
    return null;
  }
  return Array.isArray(data) ? data[0] : data;
}

export async function updateLeadByPaymentId(paymentId, patch) {
  const cfg = config();
  if (!cfg || !paymentId) return null;

  const existing = await getLeadByPaymentId(paymentId);
  const payload = {
    ...patch,
    updated_at: new Date().toISOString(),
    last_event_at: new Date().toISOString(),
  };
  if (patch.metadata) payload.metadata = mergeMetadata(existing?.metadata, patch.metadata);

  const res = await fetch(`${cfg.baseUrl}?payment_id=eq.${encodeURIComponent(paymentId)}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('CRM update payment error:', data);
    return null;
  }
  return Array.isArray(data) ? data[0] : data;
}

export async function claimPaymentProcessing(paymentId, patch = {}) {
  const cfg = config();
  if (!cfg || !paymentId) return { claimed: true, lead: null, persisted: false };

  const existing = await getLeadByPaymentId(paymentId);
  if (!existing) return { claimed: true, lead: null, persisted: false };
  if (existing.metadata?.purchase_processed_at) {
    return { claimed: false, lead: existing, persisted: true };
  }

  const processedAt = new Date().toISOString();
  const payload = {
    ...patch,
    metadata: mergeMetadata(existing.metadata, {
      ...(patch.metadata || {}),
      purchase_processed_at: processedAt,
    }),
    updated_at: processedAt,
    last_event_at: processedAt,
  };
  const params = new URLSearchParams({
    payment_id: `eq.${paymentId}`,
    'metadata->>purchase_processed_at': 'is.null',
  });
  const res = await fetch(`${cfg.baseUrl}?${params.toString()}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('CRM claim payment error:', data);
    // Never suppress fulfillment for an approved payment because the CRM lock
    // is temporarily unavailable. Meta still deduplicates Purchase by event_id.
    return { claimed: true, lead: existing, persisted: false };
  }
  const lead = Array.isArray(data) ? data[0] : data;
  return { claimed: Boolean(lead), lead: lead || existing, persisted: true };
}

export async function listLeads({ status, q, limit = 100 } = {}) {
  const cfg = config();
  if (!cfg) return { configured: false, leads: [] };

  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('order', 'created_at.desc');
  params.set('limit', String(Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500)));
  if (status && status !== 'all') params.set('funnel_status', `eq.${status}`);
  if (q) {
    const safe = String(q).replace(/[%(),]/g, '').slice(0, 80);
    params.set('or', `(name.ilike.*${safe}*,email.ilike.*${safe}*,phone.ilike.*${safe}*,payment_id.ilike.*${safe}*,metadata->>x1_ref.ilike.*${safe}*)`);
  }

  const res = await fetch(`${cfg.baseUrl}?${params.toString()}`, {
    headers: headers(),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('CRM list error:', data);
    return { configured: true, error: 'Erro ao carregar leads.', leads: [] };
  }
  return { configured: true, leads: data || [] };
}

export async function findRecoveryCandidates() {
  const cfg = config();
  if (!cfg) return [];

  const params = new URLSearchParams({
    select: '*',
    funnel_status: 'eq.pix_generated',
    payment_method: 'eq.pix',
    recovery_stage: 'lt.3',
    order: 'pix_generated_at.asc',
    limit: '50',
  });

  const res = await fetch(`${cfg.baseUrl}?${params.toString()}`, {
    headers: headers(),
  });

  const data = await res.json().catch(() => []);
  if (!res.ok) {
    console.error('CRM recovery list error:', data);
    return [];
  }
  return data || [];
}

export async function updateLeadById(id, patch) {
  const cfg = config();
  if (!cfg || !id) return null;

  const existing = await getLeadById(id);
  const payload = {
    ...patch,
    updated_at: new Date().toISOString(),
    last_event_at: new Date().toISOString(),
  };
  if (patch.metadata) payload.metadata = mergeMetadata(existing?.metadata, patch.metadata);

  const res = await fetch(`${cfg.baseUrl}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('CRM update id error:', data);
    return null;
  }
  return Array.isArray(data) ? data[0] : data;
}
