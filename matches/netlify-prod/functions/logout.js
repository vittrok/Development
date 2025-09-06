// functions/logout.js
/* eslint-disable */
const crypto = require('crypto');
const { corsHeaders, getPool } = require('./_utils');

const pool = getPool();

function extractSid(event) {
  const cookie = event.headers?.cookie || event.headers?.Cookie || '';
  const m = /(?:^|;\s*)session=([^;]+)/i.exec(cookie);
  if (!m) return null;
  const signed = decodeURIComponent(m[1]);
  return String(signed).split('.')[0] || null; // "sid.sig" -> "sid"
}

function b64urlToBuf(s) {
  // допускаємо як base64url, так і звичайний base64
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  // паддінг
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function tsFresh(ts, maxAgeMs = 1000 * 60 * 60 * 12) {
  const t = Number(ts);
  return Number.isFinite(t) && Math.abs(Date.now() - t) <= maxAgeMs;
}

function pickSecrets() {
  const cands = [
    process.env.CSRF_SECRET,
    process.env.SESSION_SECRET,
    process.env.JWT_SECRET,
    process.env.CSRF_TOKEN_SECRET,
  ].filter(Boolean);
  // fallback для деву
  return cands.length ? cands : ['dev-secret'];
}

function hmac256Base64Url(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('base64url');
}

/** Перевіряємо формат "<payload>.<sig>", підпис (будь-яким із відомих секретів) і свіжість ts */
function verifyCsrfHeader(event) {
  const hdr =
    event.headers?.['x-csrf'] ||
    event.headers?.['X-CSRF'] ||
    event.headers?.['x-csrf'.toLowerCase()];
  if (!hdr || typeof hdr !== 'string') return false;

  const parts = hdr.split('.');
  if (parts.length !== 2) return false;
  const [payloadPart, sigPart] = parts;

  let payloadObj = null;
  try {
    const json = b64urlToBuf(payloadPart).toString('utf8');
    payloadObj = JSON.parse(json);
  } catch {
    return false;
  }
  if (!payloadObj || !tsFresh(payloadObj.ts)) return false;

  const expectedMatches = pickSecrets().some((sec) => {
    const calc = hmac256Base64Url(sec, payloadPart);
    try {
      // захист від побічних каналів
      const a = Buffer.from(calc, 'utf8');
      const b = Buffer.from(sigPart, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });

  return expectedMatches;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  try {
    if (!verifyCsrfHeader(event)) {
      return { statusCode: 403, headers: corsHeaders(), body: 'forbidden' };
    }

    const sid = extractSid(event);
    if (sid) {
      await pool.query(`UPDATE sessions SET revoked = true WHERE sid = $1`, [sid]);
    }

    // Затираємо cookie
    const cookie = [
      'session=;',
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ].join('; ');

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Set-Cookie': cookie, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    console.error('[/logout] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'logout failed' };
  }
};
