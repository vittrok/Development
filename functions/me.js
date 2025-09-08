// File: functions/me.js

// --- CORS / security ---
const ALLOWED_ORIGIN = 'https://football-m.netlify.app';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF, Cookie',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff'
};

// --- Helpers: respond ---
function json(status, body, extra = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra },
    body: JSON.stringify(body)
  };
}

// --- CSRF: simple token per request (stateless) ---
// У проді ви можете генерувати токен детерміновано з сесії/секрету.
// Тут — безпечний random на кожен /me для простоти.
function genCsrf() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- DB client ---
// В архітектурі передбачено централізований клієнт БД (Neon/Postgres).
// Якщо у вас є локальний хелпер (наприклад, ./_lib/db.js), імпортуйте його.
// Нижче — легка інлайн-ініціалізація через pg з connection string з ENV.
const { Client } = require('pg');
const crypto = require('crypto');

// Параметри підтягуємо з env (Netlify → Site settings → Environment)
const PG_CONNECTION_STRING = process.env.PG_CONNECTION_STRING;

// --- Session helpers ---
// Простий парсер cookie "session=<value>"
function parseSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map(s => s.trim());
  const kv = parts.find(p => p.toLowerCase().startsWith('session='));
  if (!kv) return null;
  return kv.substring('session='.length);
}

// Валідація сесії в таблиці sessions (архітектура v1.1)
async function getSessionRecord(client, sessionValue) {
  if (!sessionValue) return null;
  const sql = `
    SELECT s.id, s.user_id, s.role, s.created_at
    FROM sessions s
    WHERE s.value = $1 AND s.revoked_at IS NULL
    LIMIT 1
  `;
  const res = await client.query(sql, [sessionValue]);
  return res.rows[0] || null;
}

// Витягаємо preferences для користувача
async function getPreferences(client, userId) {
  if (!userId) return null;
  const sql = `
    SELECT seen_color, sort, bg_color
    FROM preferences
    WHERE user_id = $1
    LIMIT 1
  `;
  const res = await client.query(sql, [userId]);
  if (res.rows.length === 0) {
    return null;
  }
  const row = res.rows[0];
  return {
    seen_color: row.seen_color || null,
    sort: row.sort || null,
    bg_color: row.bg_color || null
  };
}

// --- Handler ---
exports.handler = async (event, _context) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    // Перевіряємо Origin
    const origin = event.headers.origin || event.headers.Origin;
    if (origin && origin !== ALLOWED_ORIGIN) {
      return json(403, { ok: false, error: 'forbidden_origin' });
    }

    // Зчитуємо cookie: session=<...>
    const cookieHeader = event.headers.cookie || event.headers.Cookie;
    const sessionValue = parseSessionCookie(cookieHeader);

    // Ініціалізуємо БД
    const client = new Client({ connectionString: PG_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
    await client.connect();

    let auth = { isAuthenticated: false, role: 'guest', sid_prefix: null };
    let preferences = null;

    if (sessionValue) {
      const sess = await getSessionRecord(client, sessionValue);
      if (sess && sess.user_id) {
        auth = {
          isAuthenticated: true,
          role: sess.role || 'user',
          sid_prefix: typeof sess.id === 'string' ? sess.id.substring(0, 8) : null
        };
        preferences = await getPreferences(client, sess.user_id);
      }
    }

    // CSRF токен для подальших POST
    const csrf = genCsrf();

    await client.end();

    return json(200, {
      ok: true,
      auth,
      csrf,
      // важливо: завжди повертати ключ, навіть якщо null — це спрощує фронт
      preferences: preferences || { seen_color: null, sort: null, bg_color: null }
    });
  } catch (e) {
    console.error('me.js error', e);
    return json(500, { ok: false, error: 'internal_error' });
  }
};
