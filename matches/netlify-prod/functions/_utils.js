// functions/_utils.js (CommonJS)
const crypto = require('crypto');
const { Pool } = require('pg');

// ----- env -----
const ORIGIN = process.env.APP_ORIGIN;                   // e.g. https://football-m.netlify.app
const ADMIN = `Bearer ${process.env.ADMIN_TOKEN}`;
const CSRF_SECRET = process.env.CSRF_SECRET;

// ----- pg pool (shared) -----
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ----- CORS helpers -----
function corsHeaders(origin = ORIGIN) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-CSRF',
    'Access-Control-Max-Age': '600',
  };
}
function isAllowedOrigin(event) {
  const o = event.headers.origin || '';
  // allow if no APP_ORIGIN set (dev) or exact match in prod
  return !ORIGIN || o === ORIGIN;
}
function handleOptions() {
  return { statusCode: 204, headers: corsHeaders() };
}

// ----- admin bearer auth -----
function requireAdmin(event) {
  const got = event.headers.authorization || '';
  return got === ADMIN;
}

// ----- stateless CSRF (HMAC-signed) -----
function signCsrf(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', CSRF_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifyCsrf(token, bind) {
  if (!token) return false;
  const [data, sig] = token.split('.');
  const good = crypto.createHmac('sha256', CSRF_SECRET).update(data).digest('base64url');
  if (sig !== good) return false;
  let obj;
  try { obj = JSON.parse(Buffer.from(data, 'base64url').toString()); }
  catch { return false; }
  const now = Date.now();
  if (!obj.ts || now - obj.ts > 2 * 60 * 60 * 1000) return false; // TTL 2h
  if (bind && (obj.ip !== bind.ip || obj.ua !== bind.ua)) return false;
  return true;
}

// ----- simple rate limit backed by Postgres -----
// create table once in DB (we'll run this later in step 9):
// CREATE TABLE IF NOT EXISTS rate_limits(
//   key TEXT PRIMARY KEY,
//   count INT NOT NULL,
//   reset_at TIMESTAMP NOT NULL
// );
async function rateLimit(key, limit, windowSec) {
  const res = await pool.query(`
    INSERT INTO rate_limits(key, count, reset_at)
    VALUES ($1, 1, NOW() + make_interval(secs => $2))
    ON CONFLICT (key)
    DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at < NOW() THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at < NOW() THEN NOW() + make_interval(secs => $2) ELSE rate_limits.reset_at END
    RETURNING count, reset_at
  `, [key, windowSec]);
  const row = res.rows[0];
  const remaining = Math.max(0, limit - row.count);
  const reset = new Date(row.reset_at);
  const limited = row.count > limit;
  return { limited, remaining, reset };
}

// ----- input guards -----
function safeJson(body) {
  try { return JSON.parse(body || '{}'); } catch { return null; }
}
function sanitizeComment(s) {
  if (typeof s !== 'string') return null;
  s = s.slice(0, 2000);
  return s.replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, ' ');
}
function validDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

module.exports = {
  // pg
  pool,
  // cors
  corsHeaders, isAllowedOrigin, handleOptions,
  // auth
  requireAdmin,
  // csrf
  signCsrf, verifyCsrf,
  // rate limit
  rateLimit,
  // utils
  safeJson, sanitizeComment, validDate,
};
