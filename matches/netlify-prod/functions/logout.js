// functions/logout.js
/* eslint-disable */
const { corsHeaders, getPool, verifySigned } = require('./_utils');

const pool = getPool();

function extractSid(event) {
  const cookie = event.headers?.cookie || event.headers?.Cookie || '';
  const m = /(?:^|;\s*)session=([^;]+)/i.exec(cookie);
  if (!m) return null;
  const signed = decodeURIComponent(m[1]);
  return String(signed).split('.')[0] || null; // "sid.sig" -> "sid"
}

function verifyCsrfHeader(event) {
  const hdr =
    event.headers?.['x-csrf'] ||
    event.headers?.['X-CSRF'] ||
    event.headers?.['x-csrf'.toLowerCase()];
  if (!hdr || typeof hdr !== 'string') return false;

  let payload = null;
  try {
    // очікуємо формат "base64(payload).signature" (verifySigned з _utils перевіряє HMAC)
    payload = verifySigned(hdr);
  } catch (_) {
    return false;
  }
  if (!payload || typeof payload !== 'object') return false;

  // Перевіряємо лише «свіжість» токена
  const MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12 год
  const t = Number(payload.ts);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(Date.now() - t) > MAX_AGE_MS) return false;

  return true;
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
    // CSRF обов’язковий
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
