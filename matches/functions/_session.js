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
    if (cookie) {
      // простий парсер cookie
      const map = {};
      for (const part of String(cookie).split(/;\s*/)) {
        const i = part.indexOf('=');
        if (i > 0) map[part.slice(0, i)] = part.slice(i + 1);
      }
      if (map[COOKIE_NAME]) return map[COOKIE_NAME];
    }
  }
  return null;
}

/**
 * HMAC-підпис sid у форматі HEX (узгоджено з login та /me)
 */
function signSidHex(sid, secret = process.env.SESSION_SECRET || 'dev-secret') {
  return crypto.createHmac('sha256', String(secret)).update(String(sid)).digest('hex');
}

/**
 * Історично тут був base64url — лишимо для сумісності.
 */
function signSidB64Url(sid, secret = process.env.SESSION_SECRET || 'dev-secret') {
  return crypto.createHmac('sha256', String(secret)).update(String(sid)).digest('base64url');
}

/**
 * Перевіряє підпис "sid.sig", приймає як HEX, так і base64url. Повертає валідний sid або null.
 */
function verifySigned(signed, secret = process.env.SESSION_SECRET || 'dev-secret') {
  if (!signed || typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;

  const sid = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  if (!sid || !sig) return null;

  // готуємо обидва варіанти правильного підпису
  const goodHex = signSidHex(sid, secret);
  const goodB64 = signSidB64Url(sid, secret);

  try {
    const a = Buffer.from(String(sig), 'utf8');
    // Перевіряємо HEX
    const bHex = Buffer.from(String(goodHex), 'utf8');
    if (a.length === bHex.length && crypto.timingSafeEqual(a, bHex)) return sid;

    // Перевіряємо base64url
    const bB64 = Buffer.from(String(goodB64), 'utf8');
    if (a.length === bB64.length && crypto.timingSafeEqual(a, bB64)) return sid;
  } catch {
    return null;
  }

  return null;
}

/**
 * getSession(signed)
 *  - приймає "sid.sig", перевіряє підпис; якщо ок — шукає активну сесію в БД
 *  - повертає { sid, role } або null
 */
async function getSession(signed) {
  if (!signed) return null;

  // дозволяємо також подавати event; виймемо звідти
  if (typeof signed !== 'string') {
    const ex = extractSigned(signed);
    if (ex) signed = ex;
  }

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
 * Повертає { sid, role, expiresAt }.
 */
async function createSession(userIdOrObj, role, ttlSeconds) {
  let userId, r = role, ttl = ttlSeconds;
  if (typeof userIdOrObj === 'object' && userIdOrObj) {
    userId = userIdOrObj.userId;
    r     = userIdOrObj.role ?? r;
    ttl   = userIdOrObj.ttlSeconds ?? ttl;
  } else {
    userId = userIdOrObj;
  }
  if (!userId) throw new Error('createSession: userId required');

  const s = String(Math.random()).slice(2) + '-' + Date.now();
  const expiresAt = new Date(Date.now() + (Number(ttl) > 0 ? Number(ttl) : 30*24*60*60) * 1000);

  try {
    await pool.query(
      `INSERT INTO sessions (sid, user_id, role, expires_at, revoked, created_at)
       VALUES ($1, $2, $3, $4, false, NOW())`,
      [s, userId, r || 'user', expiresAt]
    );
  } catch (e) {
    console.error('[createSession] db error:', e);
    throw e;
  }

  return { sid: s, role: r || 'user', expiresAt: expiresAt.toISOString() };
}

module.exports = {
  getSession,
  createSession,
  // Експортуємо обидва для потенційних тестів/міграцій
  signSidHex,
  signSidB64Url,
  verifySigned,
  extractSigned,
  COOKIE_NAME,
};
