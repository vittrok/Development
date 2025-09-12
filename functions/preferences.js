// File: functions/preferences.js
// Реалізація під поточний код бази (як у me.js):
// - Авторизація через requireAuth → отримуємо sid
// - По sid дістаємо user_id із sessions
// - Зчитуємо/записуємо JSONB у user_preferences.data (keys: seen_color, sort_col, sort_order)
// - CSRF як у /me: очікуємо X-CSRF = HMAC(CSRF_SECRET, sid) (hex)
//
// Це тимчасово відхиляється від архітектури v1.1 (таблиця 'preferences'),
// але узгоджено з наявною реалізацією (/me). Після стабілізації перенесемося на таблицю 'preferences'.

const crypto = require('crypto');
const { getPool, corsHeaders } = require('./_utils');
const { requireAuth } = require('./_auth');

const pool = getPool();
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://football-m.netlify.app';
const CSRF_SECRET = process.env.CSRF_SECRET || '';

const ALLOWED_COLS = ['rank','match','tournament','date','link','seen','comments','kickoff_at','home_team','away_team','status'];
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
  return crypto.createHmac('sha256', secret).update(String(msg)).digest('hex');
}

async function getUserIdBySid(sid) {
  const q = `
    SELECT s.user_id, s.expires_at, s.revoked
    FROM sessions s
    WHERE s.sid = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [sid]);
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
  // Back-compat: якщо є data.sort = "date_desc" → розкласти (опц.)
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
               updated_at = now()
         WHERE user_id=$1`,
        [userId, JSON.stringify(patch)]
      );
    } else {
      await pool.query(
        `INSERT INTO user_preferences (user_id, data, updated_at)
         VALUES ($1, $2::jsonb, now())`,
        [userId, JSON.stringify(patch)]
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function _handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // requireAuth додає event.auth = { sid, role }
  if (!event.auth || !event.auth.sid) {
    return json(401, { ok:false, error:'unauthorized' });
  }

  const sid = event.auth.sid;
  const userId = await getUserIdBySid(sid);
  if (!userId) {
    return json(401, { ok:false, error:'unauthorized' });
  }

  if (event.httpMethod === 'GET') {
    try {
      const data = await getPrefs(userId);
      return json(200, { ok:true, data });
    } catch (e) {
      return json(500, { ok:false, error:'internal_error', detail: String(e?.message||e) });
    }
  }

  if (event.httpMethod === 'POST') {
    // CSRF: очікуємо X-CSRF = HMAC(CSRF_SECRET, sid) (hex), як у /me
    const hdrs = event.headers || {};
    const csrf = hdrs['x-csrf'] || hdrs['X-CSRF'] || hdrs['x-csrf-token'] || hdrs['X-CSRF-Token'];
    const expected = CSRF_SECRET ? hmacHex(CSRF_SECRET, sid) : null;
    if (!expected || csrf !== expected) {
      return json(403, { ok:false, error:'csrf_required_or_invalid' });
    }

    // Парсинг тіла
    let payload = {};
    const ct = String(hdrs['content-type'] || '').toLowerCase();
    try {
      if (!event.body) {
        payload = {};
      } else if (ct.includes('application/json')) {
        payload = JSON.parse(event.body);
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        payload = {};
        for (const kv of String(event.body).split('&')) {
          const [k, v=''] = kv.split('=');
          payload[decodeURIComponent(k.replace(/\+/g,' '))] = decodeURIComponent(v.replace(/\+/g,' '));
        }
      } else {
        payload = JSON.parse(event.body);
      }
    } catch {
      return json(400, { ok:false, error:'invalid_json' });
    }

    // Валідації
    const patch = {};
    if (payload.seen_color != null) {
      if (!isValidColor(payload.seen_color)) return json(400, { ok:false, error:'invalid_seen_color' });
      patch.seen_color = String(payload.seen_color).trim();
    }
    if (payload.sort_col != null) {
      const col = String(payload.sort_col).trim();
      if (!ALLOWED_COLS.includes(col)) return json(400, { ok:false, error:'invalid_sort_col' });
      patch.sort_col = col;
    }
    if (payload.sort_order != null) {
      const ord = String(payload.sort_order).trim().toLowerCase();
      if (!['asc','desc'].includes(ord)) return json(400, { ok:false, error:'invalid_sort_order' });
      patch.sort_order = ord;
    }
    if (!Object.keys(patch).length) {
      return json(400, { ok:false, error:'nothing_to_update' });
    }

    try {
      await upsertPrefs(userId, patch);
      return json(200, { ok:true });
    } catch (e) {
      return json(500, { ok:false, error:'internal_error', detail: String(e?.message||e) });
    }
  }

  return json(405, { ok:false, error:'method_not_allowed' });
}

// Обгортаємо реальним requireAuth, щоб мати event.auth.sid/role та єдині CORS
exports.handler = requireAuth(_handler);
