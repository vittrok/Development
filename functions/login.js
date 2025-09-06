// functions/login.js
/* eslint-disable */
const crypto = require('crypto');
const { corsHeaders, getPool } = require('./_utils');
const { createSession } = require('./_session');

const pool = getPool();

/* -------------------- robust body parsing -------------------- */
function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function maybeDecodePercent(s) {
  try { return decodeURIComponent(String(s).replace(/\+/g, '%20')); } catch { return s; }
}
function fromUrlEncoded(raw) {
  const params = new URLSearchParams(String(raw).replace(/^\?/, ''));
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  return obj;
}
function getJsonBody(event) {
  if (!event) return null;
  let raw = event.body;

  // Netlify може передавати base64
  if (event.isBase64Encoded && typeof raw === 'string') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {}
  }

  // Якщо під час dev body вже об'єкт
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;

  raw = raw.trim();
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  // 1) form-urlencoded або рядок типу a=b&c=d
  if (ct.includes('application/x-www-form-urlencoded') || (!raw.startsWith('{') && raw.includes('='))) {
    return fromUrlEncoded(raw);
  }

  // 2) нормальний JSON
  let obj = tryParseJSON(raw);
  if (obj) return obj;

  // 3) відсотково-кодований JSON (%7B...%7D)
  if (raw.startsWith('%7B') || raw.includes('%7B%')) {
    obj = tryParseJSON(maybeDecodePercent(raw));
    if (obj) return obj;
  }

  // 4) інколи приходить у лапках (рядок JSON всередині рядка)
  if (raw.startsWith('"') && raw.endsWith('"')) {
    obj = tryParseJSON(raw.slice(1, -1));
    if (obj) return obj;
  }

  // Якщо нічого не вийшло — повертаємо null (не кидаємо)
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

    // 1) Знаходимо користувача
    const q = `
      SELECT id, username, role, password_hash, password
      FROM users
      WHERE username = $1
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [username]);
    if (!rows.length) {
      return { statusCode: 401, headers: corsHeaders(), body: 'login failed' };
    }
    const user = rows[0];

    // 2) Перевіряємо пароль (спочатку bcrypt-хеш, потім plain fallback)
    let ok = false;
    if (user.password_hash && bcrypt) {
      try { ok = await bcrypt.compare(password, user.password_hash); } catch {}
    }
    if (!ok && user.password) {
      ok = safeEq(password, user.password);
    }
    if (!ok) {
      return { statusCode: 401, headers: corsHeaders(), body: 'login failed' };
    }

    // 3) Створюємо сесію
    const ttlSeconds = 60 * 60 * 24 * 30; // 30 днів
    const sess = await createSession({ userId: user.id, role: user.role || 'user', ttlSeconds });

    // 4) Виставляємо cookie: session=sid.sig
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
