// functions/login.js
/* eslint-disable */
const crypto = require('crypto');
const { corsHeaders } = require('./_utils');
const { getPool } = require('./_utils');
const { createSession } = require('./_session');

const pool = getPool();

/** Надійний парсер body (JSON, base64, x-www-form-urlencoded) */
function getJsonBody(event) {
  if (!event) return null;
  let raw = event.body;

  // Netlify може ставити isBase64Encoded
  if (event.isBase64Encoded && typeof raw === 'string') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (_) {}
  }

  if (raw && typeof raw === 'object') return raw; // dev/локально
  if (typeof raw !== 'string') return null;

  raw = raw.trim();
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    return obj;
  }

  return JSON.parse(raw);
}

/** Підписуємо sid для cookie "session=sid.sig" */
function signSid(sid) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret).update(String(sid)).digest('base64url');
}

/** Безпечне порівняння рядків (для fallback plain-text) */
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  try { return crypto.timingSafeEqual(aBuf, bBuf); } catch { return false; }
}

let bcrypt = null;
try { bcrypt = require('bcryptjs'); } catch (_) {
  try { bcrypt = require('bcrypt'); } catch (_) { bcrypt = null; }
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

    // 2) Перевіряємо пароль
    let ok = false;
    if (user.password_hash && bcrypt) {
      try { ok = await bcrypt.compare(password, user.password_hash); } catch (_) { ok = false; }
    }
    if (!ok && user.password) {
      ok = safeEq(password, user.password); // fallback на колонку password (якщо є)
    }
    if (!ok) {
      return { statusCode: 401, headers: corsHeaders(), body: 'login failed' };
    }

    // 3) Створюємо сесію в БД
    const ttlSeconds = 60 * 60 * 24 * 30; // 30 днів
    const sess = await createSession({ userId: user.id, role: user.role || 'user', ttlSeconds });

    // 4) Ставимо cookie session=sid.sig (першу частину sid читатиме /me)
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
      headers: { ...corsHeaders(), 'Set-Cookie': cookie },
      body: JSON.stringify({ ok: true, role: user.role || 'user' }),
    };
  } catch (e) {
    console.error('[/login] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'login failed' };
  }
};
