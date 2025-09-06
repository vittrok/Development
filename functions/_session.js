// functions/_session.js
/* eslint-disable */
const { getPool } = require('./_utils');
const pool = getPool();

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
 * input: підписане значення cookie "session" (рядок "sid.sig") або Netlify event.
 * повертає { role, sid } або null, якщо сесії нема/прострочена/відкликана.
 */
async function getSession(input) {
  const signed = extractSigned(input);
  if (!signed) return null;

  // cookie формату "sid.sig" → беремо першу частину як sid
  const sid = String(signed).split('.')[0];
  if (!sid) return null;

  const q = `
    SELECT u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.sid = $1
      AND s.revoked = false
      AND s.expires_at > now()
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

module.exports = { getSession };
