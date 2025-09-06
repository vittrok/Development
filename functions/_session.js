// functions/_session.js
/* eslint-disable */
const crypto = require('crypto');
const { getPool } = require('./_utils');

const pool = getPool();

/** Витягає значення cookie "session" (рядок формату "sid.sig") */
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
 * getSession(input)
 * input: рядок "sid.sig" або Netlify event
 * Повертає { role, sid } або null, якщо сесію не знайдено/прострочено/відкликано.
 */
async function getSession(input) {
  const signed = extractSigned(input);
  if (!signed) return null;

  // cookie "sid.sig" → беремо першу частину як sid
  const sid = String(signed).split('.')[0];
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
 * Сумісна сигнатура:
 *  - createSession(userId, role?, ttlSeconds?)
 *  - createSession({ userId, role?, ttlSeconds? })
 * Повертає { sid, role, expiresAt }.
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

module.exports = { getSession, createSession };
