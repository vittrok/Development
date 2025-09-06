// functions/login.js
/* eslint-disable */
const crypto = require('crypto');
const { corsHeaders, getPool, checkAndIncRateLimit, clientIp } = require('./_utils');
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

  if (event.isBase64Encoded && typeof raw === 'string') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {}
  }
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;

  raw = raw.trim();
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  if (ct.includes('application/x-www-form-urlencoded') || (!raw.startsWith('{') && raw.includes('='))) {
    return fromUrlEncoded(raw);
  }

  const obj = tryParseJSON(raw);
  if (obj) return obj;

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

/** Пробує знайти користувача по username → login → email. Повертає об’єкт із УСІМА полями (jsonb). */
async function findUserRecord(identifier) {
  const tries = [
    `SELECT to_jsonb(u) AS usr FROM users u WHERE u.username = $1 LIMIT 1`,
    `SELECT to_jsonb(u) AS usr FROM users u WHERE u.login    = $1 LIMIT 1`,
    `SELECT to_jsonb(u) AS usr FROM users u WHERE u.email    = $1 LIMIT 1`,
  ];
  for (const q of tries) {
    try {
      const { rows } = await pool.query(q, [identifier]);
      if (rows.length && rows[0].usr) return rows[0].usr;
    } catch (e) {
      if (!(e && e.code === '42703')) throw e;
    }
  }
  return null;
}
function pickUserId(u) { return u.id ?? u.user_id ?? u.uid ?? null; }
function pickRole(u)   { return u.role ?? u.user_role ?? 'user'; }
function pickPasswordCandidates(u) {
  const hashKeys = ['password_hash','pwd_hash','pass_hash','hash','passwordhash'];
  const plainKeys = ['password','pass','pwd'];
  let hash = null, plain = null;
  for (const k of hashKeys) if (typeof u[k] === 'string' && u[k]) { hash = u[k]; break; }
  for (const k of plainKeys) if (typeof u[k] === 'string' && u[k]) { plain = u[k]; break; }
  return { hash, plain };
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

    // === Rate limit: 5 спроб за 15 хв для IP+username ===
    const ip = clientIp(event);
    const key = `login:${ip}:${(username || '').toLowerCase()}`;
    const rl = await checkAndIncRateLimit(key, 5, 15 * 60); // 5/900s

    if (rl.limited) {
      return {
        statusCode: 429,
        headers: { ...corsHeaders(), 'Retry-After': String(rl.retryAfterSec) },
        body: 'too many attempts',
      };
    }

    // 1) Знайти користувача
    const u = await findUserRecord(username);
    if (!u) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders(), 'X-RateLimit-Remaining': String(Math.max(0, rl.remaining)) },
        body: 'login failed',
      };
    }

    // 2) Перевірити пароль
    const { hash, plain } = pickPasswordCandidates(u);
    let ok = false;

    if (!ok && hash && bcrypt) {
      try { ok = await bcrypt.compare(password, hash); } catch {}
    }
    if (!ok && plain) {
      ok = safeEq(password, plain);
    }
    if (!ok && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
      if (safeEq(username, process.env.ADMIN_USERNAME) && safeEq(password, process.env.ADMIN_PASSWORD)) {
        ok = true;
      }
    }
    if (!ok) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders(), 'X-RateLimit-Remaining': String(Math.max(0, rl.remaining)) },
        body: 'login failed',
      };
    }

    // 3) Створити сесію в БД
    const userId = pickUserId(u);
    const role   = pickRole(u);
    if (!userId) {
      return { statusCode: 500, headers: corsHeaders(), body: 'login failed' };
    }

    const ttlSeconds = 60 * 60 * 24 * 30; // 30 днів
    const sess = await createSession({ userId, role, ttlSeconds });

    // 4) Cookie session=sid.sig
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
      body: JSON.stringify({ ok: true, role }),
    };
  } catch (e) {
    console.error('[/login] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'login failed' };
  }
};
