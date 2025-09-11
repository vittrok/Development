// functions/preferences.js
/* eslint-disable */
const { requireAuth } = require('./_auth');
const { corsHeaders, getPool, requireCsrf } = require('./_utils');

const pool = getPool();

/* -------------------- robust body parsing -------------------- */
function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }

function fromUrlEncoded(raw) {
  const params = new URLSearchParams(String(raw).replace(/^\?/, ''));
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  return obj;
}

// якщо base64: спершу utf8, якщо є NUL-символи — utf16le
function decodeMaybeBase64(event) {
  let raw = event.body;
  if (event?.isBase64Encoded && typeof raw === 'string') {
    const buf = Buffer.from(raw, 'base64');
    let s = buf.toString('utf8');
    if (s.includes('\u0000')) s = buf.toString('utf16le');
    return s;
  }
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return JSON.stringify(raw);
  return '';
}

// для form-urlencoded: якщо значення виглядає як JSON — парсимо
function coerceJsonish(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        const parsed = tryParseJSON(t);
        out[k] = parsed !== null ? parsed : v;
      } else {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function getJsonBody(event) {
  const raw = decodeMaybeBase64(event).trim();
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  // form-urlencoded або вигляд a=b&c=d
  if (ct.includes('application/x-www-form-urlencoded') || (!raw.startsWith('{') && raw.includes('='))) {
    return coerceJsonish(fromUrlEncoded(raw));
  }

  // чистий JSON (спроба напряму, а потім на випадок percent-encoding)
  return tryParseJSON(raw) || tryParseJSON(decodeURIComponentSafe(raw));
}
/* --------------------------------------------------------------------------- */

exports.handler = requireAuth(async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  try {
    // auth-навантаження від HOF: event.auth = { sid, role }
    // Поточного user_id витягуємо за sid через sessions
    const { rows: who } = await pool.query(
      `SELECT s.user_id
         FROM sessions s
        WHERE s.sid = $1
          AND s.revoked = false
          AND s.expires_at > NOW()
        LIMIT 1`,
      [event.auth.sid]
    );
    if (!who.length) {
      return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
    }
    const userId = who[0].user_id;

    if (event.httpMethod === 'GET') {
      const { rows } = await pool.query(
        `SELECT data
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
      // CSRF перевірка — як у logout.js
      const csrfOk = await requireCsrf(event);
      if (!csrfOk) {
        return { statusCode: 403, headers: corsHeaders(), body: 'forbidden' };
      }

      const incoming = getJsonBody(event);
      if (!incoming || typeof incoming !== 'object') {
        return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON body' };
      }

      // shallow merge з існуючим data (jsonb ||)
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
    // архітектурно — не світимо деталі у відповідь
    console.error('[/preferences] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'preferences failed' };
  }
});
