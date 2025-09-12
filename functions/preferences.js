// File: functions/preferences.js
// Реалізація під поточний код бази (як у me.js):
// - Авторизація через requireAuth → отримуємо sid
// - По sid дістаємо user_id із sessions
// - Зчитуємо/записуємо JSONB у user_preferences.data (keys: seen_color, sort_col, sort_order)
// - CSRF як у /me: очікуємо X-CSRF = HMAC(CSRF_SECRET, sid) (hex)
// - ПІСЛЯ POST повертаємо АКТУАЛЬНИЙ стан у { ok:true, data:{...} }  ← FIX echo
//
// Це тимчасово відхиляється від архітектури v1.1 (таблиця 'preferences'),
// але узгоджено з наявною реалізацією (/me). Після стабілізації перенесемося на таблицю 'preferences'.

const crypto = require('crypto');
const { getPool, corsHeaders } = require('./_utils');
const { requireAuth } = require('./_auth');

const pool = getPool();
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://football-m.netlify.app';
const CSRF_SECRET = process.env.CSRF_SECRET || '';

/** ДОДАНО РАНІШЕ: 'league' у білий список (залишаємо) */
const ALLOWED_COLS = [
  'rank','match','tournament','date','link','seen','comments',
  'kickoff_at','home_team','away_team','status','league'
];
const ALLOWED_ORDS = ['asc','desc'];

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function isValidColor(v) {
  if (!v || typeof v !== 'string') return false;
  const s = v.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
  if (/^rgb(a)?\(/i.test(s)) return true;
  if (/^hsl(a)?\(/i.test(s)) return true;
  if (/^[a-z]+$/i.test(s)) return true;
  return false;
}

function hmacHex(secret, msg) {
  return crypto.createHmac('sha256', String(secret)).update(String(msg)).digest('hex');
}

async function findUserIdBySid(sid) {
  if (!sid) return null;
  const { rows } = await pool.query(
    `SELECT user_id, revoked, expires_at
       FROM sessions
      WHERE sid = $1
      LIMIT 1`,
    [sid]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (r.revoked) return null;
  if (!r.expires_at || new Date(r.expires_at) <= new Date()) return null;
  return r.user_id || null;
}

async function getPrefs(userId) {
  const { rows } = await pool.query(
    `SELECT data FROM user_preferences WHERE user_id=$1 LIMIT 1`,
    [userId]
  );
  const data = rows[0]?.data || {};
  const out = {};
  if (typeof data.seen_color === 'string') out.seen_color = data.seen_color;
  if (typeof data.sort_col === 'string')   out.sort_col   = data.sort_col;
  if (typeof data.sort_order === 'string') out.sort_order = data.sort_order;
  // Back-compat з data.sort ("date_desc")
  if (!out.sort_col && typeof data.sort === 'string') {
    const m = /^([a-z_]+)_(asc|desc)$/i.exec(data.sort);
    if (m) { out.sort_col = m[1]; out.sort_order = m[2].toLowerCase(); }
  }
  return out;
}

async function upsertPrefs(userId, patch) {
  await pool.query('BEGIN');
  try {
    const { rows } = await pool.query(`SELECT 1 FROM user_preferences WHERE user_id=$1`, [userId]);
    if (rows.length) {
      await pool.query(
        `UPDATE user_preferences
            SET data = COALESCE(data,'{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE user_id = $1`,
        [userId, JSON.stringify(patch)]
      );
    } else {
      await pool.query(
        `INSERT INTO user_preferences (user_id, data, updated_at)
              VALUES ($1, $2::jsonb, NOW())`,
        [userId, JSON.stringify(patch)]
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

function parseBody(event) {
  const ct = String(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
  const isB64 = !!event.isBase64Encoded;
  const raw = event.body || '';
  const text = isB64 ? Buffer.from(raw, 'base64').toString('utf8') : raw;

  // Підтримуємо JSON і x-www-form-urlencoded без сюрпризів
  if (!text) return {};
  if (ct.includes('application/json')) {
    return JSON.parse(text);
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const obj = {};
    for (const kv of String(text).split('&')) {
      const [k, v=''] = kv.split('=');
      obj[decodeURIComponent(k.replace(/\+/g,' '))] = decodeURIComponent(v.replace(/\+/g,' '));
    }
    return obj;
  }
  // Best effort: пробуємо JSON
  return JSON.parse(text);
}

async function _handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // Авторизація через requireAuth — надає event.auth.sid
  const sid = event?.auth?.sid || '';
  const method = event.httpMethod;

  // GET — просто читаємо
  if (method === 'GET') {
    try {
      const userId = await findUserIdBySid(sid);
      if (!userId) {
        // Анонімам — дефолти (узгоджено з /me)
        return json(200, { ok:true, data: { seen_color:'#fffdaa', sort_col:'kickoff_at', sort_order:'asc' } });
      }
      const data = await getPrefs(userId);
      return json(200, { ok:true, data });
    } catch (e) {
      return json(500, { ok:false, error:'server_error' });
    }
  }

  if (method === 'POST') {
    // CSRF: X-CSRF = HMAC(CSRF_SECRET, sid) (hex), як у /me
    const hdrs = event.headers || {};
    const csrf = hdrs['x-csrf'] || hdrs['X-CSRF'] || hdrs['x-csrf-token'] || hdrs['X-CSRF-Token'];
    const expected = CSRF_SECRET ? hmacHex(CSRF_SECRET, sid) : null;
    if (!expected || csrf !== expected) {
      return json(403, { ok:false, error:'csrf_required_or_invalid' });
    }

    // Парсинг тіла (підтримка base64, JSON, form)
    let payload = {};
    try {
      payload = parseBody(event);
    } catch {
      return json(400, { ok:false, error:'invalid_json' });
    }

    // Валідація і підготовка patch
    const patch = {};
    if (payload.seen_color != null) {
      if (!isValidColor(payload.seen_color)) {
        return json(400, { ok:false, error:'invalid_seen_color' });
      }
      patch.seen_color = String(payload.seen_color).trim();
    }
    if (payload.sort_col != null) {
      const col = String(payload.sort_col).trim();
      if (!ALLOWED_COLS.includes(col)) {
        return json(400, { ok:false, error:'invalid_sort_col' });
      }
      patch.sort_col = col;
    }
    if (payload.sort_order != null) {
      const ord = String(payload.sort_order).trim().toLowerCase();
      if (!ALLOWED_ORDS.includes(ord)) {
        return json(400, { ok:false, error:'invalid_sort_order' });
      }
      patch.sort_order = ord;
    }

    try {
      const userId = await findUserIdBySid(sid);
      if (!userId) {
        // Анонімам зберігати нікуди — просто повернемо дефолт/вхідні як echo
        // (За потреби можна зберігати по session_key — поза поточним кроком)
        const echo = { seen_color:'#fffdaa', sort_col:'kickoff_at', sort_order:'asc', ...patch };
        return json(200, { ok:true, data: echo });
      }

      if (Object.keys(patch).length) {
        await upsertPrefs(userId, patch);
      }
      // FIX echo: перечитуємо актуальний стан і повертаємо його
      const data = await getPrefs(userId);
      return json(200, { ok:true, data });
    } catch (e) {
      return json(500, { ok:false, error:'server_error' });
    }
  }

  return json(405, { ok:false, error:'method_not_allowed' });
}

// Обгортаємо реальним requireAuth, щоб мати event.auth.sid/role та єдині CORS
exports.handler = requireAuth(_handler);
