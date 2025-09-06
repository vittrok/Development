// functions/preferences.js
/* eslint-disable */
const { corsHeaders, getPool, requireAuth, requireCsrf } = require('./_utils');

const pool = getPool();

/* -------------------- robust body parsing (як у login.js) -------------------- */
function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function fromUrlEncoded(raw) {
  const params = new URLSearchParams(String(raw).replace(/^\?/, ''));
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  return obj;
}
function getJsonBody(event) {
  if (!event) return null;
  let raw = event.body;

  // Netlify іноді ставить isBase64Encoded=true
  if (event.isBase64Encoded && typeof raw === 'string') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {}
  }
  if (raw && typeof raw === 'object') return raw; // локальний дев
  if (typeof raw !== 'string') return null;

  raw = raw.trim();
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  // 1) form-urlencoded або вигляд a=b&c=d
  if (ct.includes('application/x-www-form-urlencoded') || (!raw.startsWith('{') && raw.includes('='))) {
    return fromUrlEncoded(raw);
  }

  // 2) чистий JSON
  const obj = tryParseJSON(raw);
  if (obj) return obj;

  // 3) нічого не вийшло
  return null;
}
/* --------------------------------------------------------------------------- */

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  // лише для автентифікованих
  const auth = await requireAuth(event);
  if (!auth.session) return auth;
  const userId = auth.session.user_id;

  try {
    if (event.httpMethod === 'GET') {
      const { rows } = await pool.query(
        `SELECT COALESCE(data, '{}'::jsonb) AS data
           FROM user_preferences
          WHERE user_id = $1
          LIMIT 1`,
        [userId]
      );

      const data = rows.length ? rows[0].data : {};
      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: true, data }),
      };
    }

    if (event.httpMethod === 'POST') {
      // CSRF обов'язковий для модифікації
      const deny = requireCsrf(event);
      if (deny) return deny;

      const incoming = getJsonBody(event);
      if (!incoming || typeof incoming !== 'object') {
        return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON body' };
      }

      // shallow merge з існуючим data
      const { rows } = await pool.query(
        `INSERT INTO user_preferences (user_id, data, updated_at)
              VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id) DO UPDATE
              SET data = user_preferences.data || EXCLUDED.data,
                  updated_at = NOW()
         RETURNING data`,
        [userId, JSON.stringify(incoming)]
      );

      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: true, data: rows[0].data }),
      };
    }

    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  } catch (e) {
    console.error('[/preferences] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'preferences failed' };
  }
};
