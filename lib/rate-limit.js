const buckets = globalThis.__duralibidRateLimitBuckets || new Map();
globalThis.__duralibidRateLimitBuckets = buckets;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 100);
}

export function enforceRateLimit(req, res, {
  namespace,
  limit,
  windowMs,
}) {
  const now = Date.now();
  const key = `${namespace}:${clientIp(req)}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 5000) {
    for (const [entryKey, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(entryKey);
    }
  }

  const remaining = Math.max(0, limit - bucket.count);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count <= limit) return true;
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
  res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  return false;
}

