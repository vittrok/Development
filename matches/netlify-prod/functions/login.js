const bcrypt = require('bcryptjs');
const {
  pool, corsHeaders, setCookie, parseCookies,
  createSession, checkAndIncRateLimit, clientIp, userAgent
} = require('./_utils');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  try {
    // rate-limit на логін: ip + глобальний
    const ip = clientIp(event);
    const { limited, retryAfterSec } = await checkAndIncRateLimit(`ip:${ip}:login`, 5, 10 * 60);
    if (limited) {
      return { statusCode: 429, headers: { ...corsHeaders(), 'Retry-After': String(retryAfterSec) }, body: 'Too Many' };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { username, password } = body || {};
    if (!username || !password) {
      return { statusCode: 400, headers: corsHeaders(), body: 'username/password required' };
    }

    // lazy-seed admin user якщо не існує
    let { rows } = await pool.query('SELECT id, username, password_hash, role FROM users WHERE username=$1', [ADMIN_USERNAME]);
    if (!rows.length) {
      if (username !== ADMIN_USERNAME) {
        return { statusCode: 401, headers: corsHeaders(), body: 'bad creds' };
      }
      if (!ADMIN_PASSWORD_HASH) {
        return { statusCode: 500, headers: corsHeaders(), body: 'ADMIN_PASSWORD_HASH not set' };
      }
      await pool.query(
        'INSERT INTO users(username, password_hash, role) VALUES ($1,$2,$3)',
        [ADMIN_USERNAME, ADMIN_PASSWORD_HASH, 'admin']
      );
      rows = (await pool.query('SELECT id, username, password_hash, role FROM users WHERE username=$1', [ADMIN_USERNAME])).rows;
    }

    const user = rows[0];
    if (username !== user.username) {
      return { statusCode: 401, headers: corsHeaders(), body: 'bad creds' };
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return { statusCode: 401, headers: corsHeaders(), body: 'bad creds' };
    }

    // створюємо сесію
    const signed = await createSession(user.id, 30);
    await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Set-Cookie': setCookie('session', signed) },
      body: JSON.stringify({ ok: true })
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: corsHeaders(), body: 'login failed' };
  }
};
