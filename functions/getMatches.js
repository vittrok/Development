// functions/getMatches.js
// Віддає матчі з урахуванням користувацьких префів сортування.
// Узгоджено з архітектурою v1.1:
// - CORS/PG через _utils
// - Авторизаційний шар через requireAuth (дає event.auth.sid/role; анонімам теж дозволяє)
// - Префи читаємо ТІЛЬКИ за user_id (session_key не використовується — його немає в схемі)
// - Анонімам дефолт: kickoff_at ASC
// - Жорсткий whitelist sort_col/sort_order

const { corsHeaders, getPool } = require('./_utils');
const { requireAuth } = require('./_auth');

const pool = getPool();

const SORT_WHITELIST = new Set([
  'kickoff_at',
  'home_team',
  'away_team',
  'tournament',
  'status',
  'league'
]);
const ORDER_WHITELIST = new Set(['asc', 'desc']);

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

// Допоміжне: знайти user_id за sid через таблицю sessions (аналогічно /preferences)
async function findUserIdBySid(client, sid) {
  if (!sid) return null;
  const q = `
    select user_id, revoked, expires_at
      from sessions
     where sid = $1
     limit 1
  `;
  const { rows } = await client.query(q, [sid]);
  if (!rows.length) return null;
  const r = rows[0];
  if (r.revoked) return null;
  if (!r.expires_at || new Date(r.expires_at) <= new Date()) return null;
  return r.user_id || null;
}

// Зчитати префи користувача (за user_id). Анонімам — дефолти.
async function readPrefs(client, userId) {
  const defaults = { sort_col: 'kickoff_at', sort_order: 'asc' };
  if (!userId) return defaults;

  const { rows } = await client.query(
    `select data
       from user_preferences
      where user_id = $1
      limit 1`,
    [userId]
  );

  if (!rows.length || !rows[0].data) return defaults;

  const merged = { ...defaults, ...rows[0].data };
  // нормалізація/захист від сміття
  const col = SORT_WHITELIST.has(merged.sort_col) ? merged.sort_col : 'kickoff_at';
  const ord = ORDER_WHITELIST.has(String(merged.sort_order).toLowerCase())
    ? String(merged.sort_order).toLowerCase()
    : 'asc';
  return { ...merged, sort_col: col, sort_order: ord };
}

// Головний хендлер (обгорнутий у requireAuth нижче)
async function _handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders(), body: '' };
    }
    if (event.httpMethod !== 'GET') {
      return json(405, { ok: false, error: 'method_not_allowed' });
    }

    const client = await pool.connect();
    try {
      // від requireAuth ми отримуємо event.auth.sid (навіть якщо анонім — буде пустий)
      const sid = event?.auth?.sid || '';
      const userId = await findUserIdBySid(client, sid);
      const prefs = await readPrefs(client, userId);

      // ORDER BY тільки з whitelist
      const orderCol = prefs.sort_col;
      const orderDir = prefs.sort_order;
      const orderBySql = `order by ${orderCol} ${orderDir}`;

      // простий вибір матчів (можете розширити SELECT за потреби)
      const { rows } = await client.query(
        `
        select
          id,
          kickoff_at,
          home_team,
          away_team,
          tournament,
          status,
          league
        from matches
        ${orderBySql}
        limit 1000
        `
      );

      return json(200, { ok: true, items: rows });
    } catch (err) {
      console.error('getMatches error:', err);
      return json(500, { ok: false, error: 'server_error' });
    } finally {
      // важливо: завжди релізимо клієнт
      // (навіть якщо вище впаде — finally відпрацює)
      // eslint-disable-next-line no-unsafe-finally
      if (typeof client?.release === 'function') client.release();
    }
  } catch (e) {
    // фейл до підключення клієнта
    console.error('getMatches fatal:', e);
    return json(500, { ok: false, error: 'server_error' });
  }
}

// Загортаємо у requireAuth, щоб мати єдині CORS та event.auth.sid/role
exports.handler = requireAuth(_handler);
