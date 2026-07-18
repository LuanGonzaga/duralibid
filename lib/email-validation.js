import { promises as dns } from 'node:dns';

const DNS_TIMEOUT_MS = 1600;

const COMMON_DOMAIN_TYPOS = {
  'gamil.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.com.br': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'homail.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yhaoo.com': 'yahoo.com',
  'iclod.com': 'icloud.com',
};

const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'maildrop.cc',
  'sharklasers.com',
]);

function baseResult(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const domain = normalized.includes('@') ? normalized.split('@').pop() : '';
  return {
    normalized,
    domain,
    accepted: false,
    valid: false,
    deliverable: false,
    has_mx: false,
    disposable: false,
    reason: 'unknown',
    message: 'Informe um e-mail valido.',
    checked_at: new Date().toISOString(),
  };
}

function syntaxLooksValid(email) {
  if (!email || email.length > 254) return false;
  const [local, domain] = email.split('@');
  if (!local || !domain || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  return /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,63}$/i.test(email);
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('DNS timeout');
          error.code = 'DNS_TIMEOUT';
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function hasMxRecord(domain) {
  const records = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS);
  return Array.isArray(records) && records.some((record) => record.exchange);
}

export function emailValidationErrorMessage(result) {
  if (!result) return 'Informe um e-mail valido.';
  if (result.suggestion) return `Confira o e-mail. Voce quis dizer ${result.suggestion}?`;
  return result.message || 'Informe um e-mail valido.';
}

export async function validateEmailAddress(email) {
  const result = baseResult(email);
  const normalized = result.normalized;

  if (!syntaxLooksValid(normalized)) {
    return {
      ...result,
      reason: 'invalid_syntax',
      message: 'E-mail invalido. Confira se digitou corretamente.',
    };
  }

  result.valid = true;

  const suggestionDomain = COMMON_DOMAIN_TYPOS[result.domain];
  if (suggestionDomain) {
    const local = normalized.split('@')[0];
    return {
      ...result,
      reason: 'likely_typo',
      suggestion: `${local}@${suggestionDomain}`,
      message: `Confira o e-mail. Voce quis dizer ${local}@${suggestionDomain}?`,
    };
  }

  if (DISPOSABLE_DOMAINS.has(result.domain)) {
    return {
      ...result,
      disposable: true,
      reason: 'disposable_domain',
      message: 'Use um e-mail principal. E-mails temporarios nao sao aceitos.',
    };
  }

  try {
    const hasMx = await hasMxRecord(result.domain);
    if (!hasMx) {
      return {
        ...result,
        reason: 'missing_mx',
        message: 'Esse dominio de e-mail nao parece receber mensagens. Confira o endereco.',
      };
    }

    return {
      ...result,
      accepted: true,
      deliverable: true,
      has_mx: true,
      reason: 'mx_found',
      message: 'Dominio de e-mail validado.',
    };
  } catch (err) {
    const code = err?.code || '';
    if (['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ENODOMAIN'].includes(code)) {
      return {
        ...result,
        reason: 'missing_mx',
        message: 'Esse dominio de e-mail nao parece receber mensagens. Confira o endereco.',
      };
    }

    return {
      ...result,
      accepted: true,
      reason: code === 'DNS_TIMEOUT' ? 'dns_timeout' : 'dns_check_unavailable',
      message: 'Formato aceito. Nao foi possivel confirmar o dominio agora.',
    };
  }
}
