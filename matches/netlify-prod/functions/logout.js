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

// --- CSRF helpers ---
function b64urlToBuf(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}
function toB64Url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function tsFresh(ts, maxAgeMs = 1000 * 60 * 60 * 12) {
  const t = Number(ts);
  return Number.isFinite(t) && Math.abs(Date.now() - t) <= maxAgeMs;
}
function pickSecrets() {
  const cands = [
    process.env.CSRF_SECRET,
    process.env.CSRF_TOKEN_SECRET,
    process.env.SESSION_SECRET,
    process.env.JWT_SECRET,
  ].filter(Boolean);
  return cands.length ? cands : ['dev-secret'];
}
function tsecEq(a, b) {
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/**
 * Перевірка X-CSRF, сумісна з різними реалізаціями signCsrf:
 * очікує "<payload>.<sig>", де payload = base64url(JSON).
 * Перевіряє HMAC підпис для 3 варіантів вхідних даних:
 *  1) base64url(payload) як є
 *  2) сирий JSON (decode(payload))
 *  3) нормалізований JSON (JSON.stringify(JSON.parse(raw)))
 */
function verifyCsrfHeader(event) {
  const hdr = event.headers?.['x-csrf'] || event.headers?.['X-CSRF'];
  if (!hdr || typeof hdr !== 'string') return false;

  const parts = hdr.split('.');
  if (parts.length !== 2) return false;
  const [payloadPart, sigPart] = parts;

  let rawJson;
  try {
    rawJson = b64urlToBuf(payloadPart).toString('utf8');
  } catch {
    return false;
  }
  let obj;
  try { obj = JSON.parse(rawJson); } catch { return false; }
  if (!obj || !tsFresh(obj.ts)) return false;

  const normalizedJson = (() => {
    try { return JSON.stringify(obj); } catch { return null; }
  })();

  const secrets = pickSecrets();
  for (const sec of secrets) {
    // варіант A: HMAC(base64url(payload))
    const sigA = toB64Url(crypto.createHmac('sha256', sec).update(payloadPart).digest());
    if (tsecEq(sigA, sigPart)) return true;

    // варіант B: HMAC(raw JSON)
    const sigB = toB64Url(crypto.createHmac('sha256', sec).update(rawJson).digest());
    if (tsecEq(sigB, sigPart)) return true;

    // варіант C: HMAC(normalized JSON)
    if (normalizedJson) {
      const sigC = toB64Url(crypto.createHmac('sha256', sec).update(normalizedJson).digest());
      if (tsecEq(sigC, sigPart)) return true;
    }
  }
  return false;
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

    // гасимо cookie
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
