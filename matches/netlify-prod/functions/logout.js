// functions/logout.js
/* eslint-disable */
const { corsHeaders, getPool, requireCsrf } = require('./_utils');

const pool = getPool();

function extractSid(event) {
  const cookie = event.headers?.cookie || event.headers?.Cookie || '';
  const m = /(?:^|;\s*)session=([^;]+)/i.exec(cookie);
  if (!m) return null;
  const signed = decodeURIComponent(m[1]);
  return String(signed).split('.')[0] || null; // "sid.sig" -> "sid"
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  // Уніфікована перевірка CSRF
  const deny = requireCsrf(event); // за замовчуванням: підпис + свіжість ts
  if (deny) return deny;

  try {
    const sid = extractSid(event);
    if (sid) {
      await pool.query(`UPDATE sessions SET revoked = true WHERE sid = $1`, [sid]);
    }

    // Гасимо cookie
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
