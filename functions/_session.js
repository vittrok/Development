// functions/_session.js
/* eslint-disable */
const crypto = require('crypto');
const { getPool } = require('./_utils');

const pool = getPool();
const COOKIE_NAME = 'session';

/**
 * Витягує значення cookie "session" (рядок формату "sid.sig")
 * Підтримує як прямий рядок "sid.sig", так і Netlify event з headers.cookie
 */
function extractSigned(input) {
  if (typeof input === 'string') return input;
  if (input && input.headers) {
    const cookie = input.headers.cookie || input.headers.Cookie || '';
    const m = /(?:^|;\s*)session=([^;]+)/i.exec(cookie);
    return m ? decodeURIComponent(m[1]) : null;
  }
  return null;
}

/**
 * HMAC-підпис sid: base64url(HMAC-SHA256(SESSION_SECRET, sid))
 */
function signSid(sid, secret = process.env.SESSION_SECRET || 'dev-secret') {
  return crypto
    .createHmac('sha256', String(secret))
    .update(String(sid))
    .digest('base64url');
}

/**
 * Перевіряє підпис "sid.sig", повертає валідний sid або null
 */
function verifySigned(signed, secret = process.env.SESSION_SECRET || 'dev-secret') {
  if (!signed || typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const sid = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  if (!sid || !sig) return null;
  const good = signSid(sid, secret);
  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(good, 'utf8');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return sid;
}

/**
 * getSession(input)
 * input: рядок "sid.sig" або Netlify event (headers.cookie)
 * Повертає { role, sid } або null (некоректний підпис/не знайдено/прострочено/відкликано)
 */
async function getSession(input) {
  const signed = extractSigned(input);
  if (!signed) return null;

  const sid = verifySigned(String(signed));
  if (!sid) return null;

  const q = `
    SELECT u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.sid = $1
      AND s.revoked = false
      AND s.expires_at > NOW()
    LIMIT 1
  `;
  try {
    const { rows } = await pool.query(q, [sid]);
    if (!rows.length) return null;
    return { role: rows[0].role || 'user', sid };
  } catch (e) {
    console.error('[getSession] db error:', e);
    return null;
  }
}

/**
 * createSession(userIdOrObj, role?, ttlSeconds?)
 * Сигнатури:
 *  - createSession(userId, role?, ttlSeconds?)
 *  - createSession({ userId, role?, ttlSeconds? })
 * Повертає { sid, role, expiresAt }.
 * Примітка: цей метод лише створює запис у БД; видача cookie виконується у відповідному ендпоїнті (login).
 */
async function createSession(userIdOrObj, maybeRole, maybeTtlSeconds) {
  let userId, role = 'user', ttlSeconds = 60 * 60 * 24 * 30; // 30 днів за замовчуванням

  if (typeof userIdOrObj === 'object' && userIdOrObj) {
    userId = userIdOrObj.userId;
    if (userIdOrObj.role) role = userIdOrObj.role;
    if (userIdOrObj.ttlSeconds) ttlSeconds = userIdOrObj.ttlSeconds;
  } else {
    userId = userIdOrObj;
    if (maybeRole) role = maybeRole;
    if (maybeTtlSeconds) ttlSeconds = maybeTtlSeconds;
  }

  if (!userId) throw new Error('createSession: userId is required');

  const sid = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const insert = `
    INSERT INTO sessions (sid, user_id, revoked, expires_at)
    VALUES ($1, $2, false, $3)
  `;
  try {
    await pool.query(insert, [sid, userId, expiresAt.toISOString()]);
  } catch (e) {
    console.error('[createSession] db error:', e);
    throw e;
  }

  return { sid, role, expiresAt: expiresAt.toISOString() };
}

module.exports = {
  getSession,
  createSession,
  signSid,
  verifySigned,
  extractSigned,
  COOKIE_NAME,
};
