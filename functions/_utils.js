// matches/netlify-prod/functions/_utils.js
// CommonJS, Netlify Functions compatible

const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); // для /login

// ---- ENV ----
const {
  APP_ORIGIN,
  DATABASE_URL,
  SESSION_SECRET,
  CSRF_SECRET,
  CSRF_TTL_MS,            // нове: TTL для CSRF у мс (опц.)
  CONTEXT                 // Netlify: 'production' | 'deploy-preview' | 'branch-deploy' | ...
} = process.env;

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
if (!SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
if (!CSRF_SECRET) throw new Error('CSRF_SECRET is not set');
// У проді APP_ORIGIN обов’язковий (у прев’ю/бранчах — не валимо білд)
if ((CONTEXT === 'production') && !APP_ORIGIN) {
  throw new Error('APP_ORIGIN is not set (required in production)');
}

// ---- PG POOL (singleton) ----
let _pool = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }  // Neon/Supabase
    });
  }
  return _pool;
}

// ---- CORS ----
// Єдиний легальний origin — APP_ORIGIN (забезпеч його в Netlify env).
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': APP_ORIGIN || 'https://example.com',
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };
}

// ---- COOKIES ----
function setCookie(name, value, { maxAgeSec = 60 * 60 * 24 * 30 } = {}) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}
function clearCookie(name) {
  return `${name}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const raw = Array.isArray(header) ? header.join(';') : header;
  raw.split(';').forEach((part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent((rest.join('=') || '').trim());
  });
  return out;
}

// ---- HELPERS (IP/UA) ----
function clientIp(event) {
  return (event.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim() || 'ip:unknown';
}
function userAgent(event) {
  return event.headers?.['user-agent'] || 'ua:unknown';
}

// ---- SESSIONS (cookie: "session" = "<sid>.<sig>") ----
function signSid(sid) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('base64url');
  return `${sid}.${sig}`;
}
function verifySid(signed) {
  const [sid, sig] = (signed || '').split('.');
  if (!sid || !sig) return null;
  const good = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  } catch {
    return null;
  }
  return sid;
}

async function createSession(userId, ttlDays = 30) {
  const pool = getPool();
  const sid = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO sessions(sid, user_id, expires_at) VALUES ($1,$2,$3)',
    [sid, userId, expiresAt]
  );
  return signSid(sid);
}

async function getSession(signedSid) {
  const pool = getPool();
  const sid = verifySid(signedSid);
  if (!sid) return null;

  const { rows } = await pool.query(
    `SELECT s.sid, s.expires_at, s.revoked,
            u.id AS user_id, u.username, u.role
       FROM sessions s
       JOIN users u ON s.user_id = u.id
      WHERE s.sid = $1`,
    [sid]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (r.revoked) return null;
  if (new Date(r.expires_at) < new Date()) return null;
  return r;
}

async function revokeSession(signedSid) {
  const pool = getPool();
  const sid = verifySid(signedSid);
  if (!sid) return;
  await pool.query('UPDATE sessions SET revoked=true WHERE sid=$1', [sid]);
}

// ---- RATE LIMIT (fixed window) ----
async function checkAndIncRateLimit(key, limit, windowSec) {
  const pool = getPool();
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSec * 1000);

  await pool.query(
    `INSERT INTO rate_limits(key, count, reset_at)
         VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at < now() THEN $2 ELSE rate_limits.reset_at END`,
    [key, resetAt]
  );

  const { rows } = await pool.query('SELECT count, reset_at FROM rate_limits WHERE key=$1', [key]);
  const row = rows[0];
  const remaining = limit - row.count;
  const retryAfterSec = Math.max(1, Math.ceil((new Date(row.reset_at) - now) / 1000));
  return { limited: row.count > limit, retryAfterSec, remaining };
}

// ---- CSRF (stateless HMAC) ----
function signCsrf(payload) {
  const data = JSON.stringify(payload || {});
  const sig = crypto.createHmac('sha256', CSRF_SECRET).update(data).digest('base64url');
  return `${Buffer.from(data).toString('base64url')}.${sig}`;
}

function verifyCsrf(token, bind = {}) {
  if (!token || typeof token !== 'string') return false;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return false;

  const dataBuf = Buffer.from(b64, 'base64url');
  let payload;
  try {
    payload = JSON.parse(dataBuf.toString('utf8'));
  } catch {
    return false;
  }

  const goodSig = crypto.createHmac('sha256', CSRF_SECRET).update(JSON.stringify(payload)).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(goodSig))) return false;
  } catch {
    return false;
  }

  if (bind.ip && payload.ip && bind.ip !== payload.ip) return false;
  if (bind.ua && payload.ua && bind.ua !== payload.ua) return false;

  const ttlMs = typeof bind.ttlMs === 'number' ? bind.ttlMs : (2 * 60 * 60 * 1000);
  if (typeof payload.ts === 'number') {
    const age = Date.now() - payload.ts;
    if (age < 0 || age > ttlMs) return false;
  } else {
    return false;
  }

  return true;
}

/** Мідлвар для CSRF: повертає null або готову 403-відповідь */
function requireCsrf(event, opts = {}) {
  const headers = event?.headers || {};
  const token = headers['x-csrf'] || headers['X-CSRF'];

  const bind = {};
  if (opts.bindIp) bind.ip = clientIp(event);
  if (opts.bindUa) bind.ua = userAgent(event);

  // нове: TTL із env за замовчуванням
  const envTtl = Number(CSRF_TTL_MS);
  bind.ttlMs = typeof opts.ttlMs === 'number'
    ? opts.ttlMs
    : (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : undefined);

  const ok = verifyCsrf(token, bind);
  if (!ok) {
    return { statusCode: 403, headers: corsHeaders(), body: 'forbidden' };
  }
  return null;
}

// ---- AUTH middlewares ----
function readSignedSessionCookie(event) {
  const cookies = parseCookies(event.headers?.cookie || event.headers?.Cookie);
  return cookies['session'] || null;
}

/** requireAuth(event) → { session } | 401 */
async function requireAuth(event) {
  const signed = readSignedSessionCookie(event);
  if (!signed) {
    return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
  }
  const sess = await getSession(signed);
  if (!sess) {
    return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
  }
  return { session: sess };
}

/** requireAdmin(event) → { session } | 401/403 */
async function requireAdmin(event) {
  const res = await requireAuth(event);
  if (!res.session) return res; // 401
  if (res.session.role !== 'admin') {
    return { statusCode: 403, headers: corsHeaders(), body: 'forbidden' };
  }
  return res; // { session }
}

// ---- EXPORTS ----
module.exports = {
  // PG
  getPool,

  // CORS
  corsHeaders,

  // Cookies
  setCookie,
  clearCookie,
  parseCookies,

  // Session
  signSid,
  verifySid,
  createSession,
  getSession,
  revokeSession,

  // Rate limit
  checkAndIncRateLimit,

  // CSRF
  signCsrf,
  verifyCsrf,
  requireCsrf,

  // AuthZ
  readSignedSessionCookie,
  requireAuth,
  requireAdmin,

  // Helpers
  clientIp,
  userAgent,

  // bcrypt для login.js
  bcrypt
};


// ---------------------------
// AUTH: de-duplication proxy
// ---------------------------
// Єдина реалізація HOF requireAuth тепер живе в ./_auth.js.
// Будь-які імпорти requireAuth з _utils залишаються працездатними.
try {
  const { requireAuth } = require('./_auth');
  module.exports.requireAuth = requireAuth;
} catch (e) {
  // Якщо з якоїсь причини _auth недоступний — не валимо увесь utils.
  // Але в проді _auth має бути присутній.
  console.error('[utils] requireAuth proxy error:', e && e.message ? e.message : e);
}
// ---------------------------