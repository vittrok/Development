// functions/getMatches.js
// Віддає матчі з урахуванням користувацьких префів сортування.
// Виправлення: динамічний ORDER BY за sort_col/sort_order з жорстким whitelist.
// Анонімам — дефолт kickoff_at ASC. Авторизованим — з user_preferences (jsonb).

const { Pool } = require('pg');

const ALLOWED_ORIGIN = process.env.APP_ORIGIN;
const DATABASE_URL   = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, Cookie',
  };
}

function http(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
    body: JSON.stringify(body),
  };
}

function ensureOrigin(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (!ALLOWED_ORIGIN || origin !== ALLOWED_ORIGIN) {
    return { ok: false, res: http(403, { ok: false, error: 'forbidden_origin' }) };
  }
  return { ok: true };
}

const SORT_WHITELIST = new Set(['league', 'kickoff_at']);
const ORDER_WHITELIST = new Set(['asc', 'desc']);

function getUserIdFromCookies(cookieHeader) {
  // Див. коментар у preferences.js — тут заглушка.
  return null;
}
function getSessionKeyFromCookies(cookieHeader) {
  return null;
}

async function readPrefs(client, userId, sessionKey) {
  const defaults = { sort_col: 'kickoff_at', sort_order: 'asc' };
  if (!userId && !sessionKey) return defaults;

  const { rows } = await client.query(
    `select data
       from user_preferences
      where (user_id = $1) or (session_key = $2)
      order by updated_at desc
      limit 1`,
    [userId, sessionKey]
  );
  if (!rows.length || !rows[0].data) return defaults;

  const merged = { ...defaults, ...rows[0].data };
  // нормалізація/захист від сміття:
  const col = SORT_WHITELIST.has(merged.sort_col) ? merged.sort_col : 'kickoff_at';
  const ord = ORDER_WHITELIST.has(String(merged.sort_order).toLowerCase())
    ? String(merged.sort_order).toLowerCase()
    : 'asc';
  return { ...merged, sort_col: col, sort_order: ord };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const originCheck = ensureOrigin(event);
  if (!originCheck.ok) return originCheck.res;

  const client = await pool.connect();
  try {
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const userId = getUserIdFromCookies(cookieHeader);
    const sessionKey = getSessionKeyFromCookies(cookieHeader);
    const prefs = await readPrefs(client, userId, sessionKey);

    // Будуємо безпечний ORDER BY
    // (лише whitelisted колонки/напрямки, без параметрів у іменах)
    const orderCol = prefs.sort_col;  // гарантовано з whitelist
    const orderDir = prefs.sort_order; // 'asc' | 'desc'

    const orderBySql = `order by ${orderCol} ${orderDir}, id asc`;

    // Мінімальна вибірка: підлаштуйте під вашу реальну таблицю/колонки.
    // ВАЖЛИВО: жодних user-controlled значень у самих даних ORDER BY (тільки whitelist).
    const { rows } = await client.query(
      `
      select
        id,
        league,
        tournament,
        home_team,
        away_team,
        kickoff_at,
        status,
        source_url
      from matches
      ${orderBySql}
      limit 1000
      `
    );

    return http(200, { ok: true, items: rows });
  } catch (err) {
    console.error('getMatches error:', err);
    return http(500, { ok: false, error: 'server_error' });
  } finally {
    client.release();
  }
};
