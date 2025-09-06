// functions/login.js
/* eslint-disable */
const crypto = require('crypto');
const { corsHeaders, getPool } = require('./_utils');
const { createSession } = require('./_session');

const pool = getPool();

/* -------------------- robust body parsing -------------------- */
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

  // Netlify інколи ставить isBase64Encoded=true
  if (event.isBase64Encoded && typeof raw === 'string') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {}
  }
  if (raw && typeof raw === 'object') return raw; // локальні дев-сценарії
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
/* ------------------------------------------------------------- */

function signSid(sid) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret).update(String(sid)).digest('base64url');
}
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const A = Buffer.from(a, 'utf8');
  const B = Buffer.from(b, 'utf8');
  if (A.length !== B.length) return false;
  try { return crypto.timingSafeEqual(A, B); } catch { return false; }
}

let bcrypt = null;
try { bcrypt = require('bcryptjs'); } catch { try { bcrypt = require('bcrypt'); } catch { bcrypt = null; } }

/** Гнучке діставання користувача з різними схемами колонок */
async function getUserByUsername(username) {
  // варіант 1: password_hash + password
  const q1 = `
    SELECT id, username, role, password_hash, password
    FROM users
    WHERE username = $1
    LIMIT 1
  `;
  try {
    const { rows } = await pool.query(q1, [username]);
    if (rows.length) return rows[0];
  } catch (e) {
    // якщо undefined_column (42703) — спробуємо інший запит
    if (e && e.code !== '42703') throw e;
  }

  // варіант 2: тільки password (plain)
  const q2 = `
    SELECT id, username, role, password
    FROM users
    WHERE username = $1
    LIMIT 1
  `;
  try {
    const { rows } = await pool.query(q2, [username]);
    if (rows.length) return rows[0];
  } catch (e) {
    if (e && e.code !== '42703') throw e;
  }

  // варіант 3: без пароля (дозволить fallback на ADMIN_* env)
  const q3 = `
    SELECT id, username, role
    FROM users
    WHERE username = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(q3, [username]);
  return rows[0] || null;
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
    const body = getJsonBody(event);
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
      return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON body' };
    }
    const { username, password } = body;

    // 1) Знайти користувача
    const user = await getUserByUsername(username);
    if (!user) {
      return { statusCode: 401, headers: corsHeaders(), body: 'login failed' };
    }

    // 2) Перевірити пароль: bcrypt → plain → ADMIN_* fallback
    let ok = false;

    if (!ok && user.password_hash && bcrypt) {
      try { ok = await bcrypt.compare(password, user.password_hash); } catch {}
    }
    if (!ok && user.password) {
      ok = safeEq(password, user.password);
    }
    if (!ok && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
      if (safeEq(username, process.env.ADMIN_USERNAME) && safeEq(password, process.env.ADMIN_PASSWORD)) {
        ok = true;
      }
    }

    if (!ok) {
      return { statusCode: 401, headers: corsHeaders(), body: 'login failed' };
    }

    // 3) Створити сесію
    const ttlSeconds = 60 * 60 * 24 * 30; // 30 днів
    const sess = await createSession({ userId: user.id, role: user.role || 'user', ttlSeconds });

    // 4) Виставити cookie: session=sid.sig
    const sig = signSid(sess.sid);
    const cookieVal = encodeURIComponent(`${sess.sid}.${sig}`);
    const cookie = [
      `session=${cookieVal}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      `Max-Age=${ttlSeconds}`,
    ].join('; ');

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Set-Cookie': cookie, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, role: user.role || 'user' }),
    };
  } catch (e) {
    console.error('[/login] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'login failed' };
  }
};
