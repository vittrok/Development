// functions/getMatches.js
// Бекенд-сортування з урахуванням пер-юзерних преференсів, збережених у user_preferences (jsonb).
// Якщо користувач неавторизований або немає збережених ключів -> дефолтне сортування за kickoff_at ASC.
//
// Публічний доступ: так (не вимагаємо обов'язкового логіну для перегляду).
// Персоналізація сортування: так, якщо є валідна сесія.
//
// Залежності: _utils.getPool, _utils.corsHeaders, _session.verifySigned/_session.extractSigned

const { getPool, corsHeaders } = require('./_utils');
const { verifySigned, extractSigned } = require('./_session');

const pool = getPool();

// БІЛИЙ СПИСОК колонок для ORDER BY (ключ преференса -> назва колонки в БД)
const ORDERABLE = {
  kickoff_at:  'kickoff_at',
  rank:        'rank',
  tournament:  'tournament',
  league:      'league',      // <- важливо: додано 'league'
  status:      'status',
  home_team:   'home_team',
  away_team:   'away_team',
};

const DEFAULT_SORT_COL  = 'kickoff_at';
const DEFAULT_SORT_DIR  = 'asc'; // 'asc' або 'desc'

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

async function getUserIdFromCookie(event) {
  const signed = extractSigned(event);           // читає Cookie: session=<sid>.<sig>
  if (!signed) return null;
  const verified = verifySigned(signed);         // { sid } | null
  if (!verified || !verified.sid) return null;

  // По sid — шукаємо user_id в sessions
  const { rows } = await pool.query(
    `SELECT user_id, revoked, expires_at
       FROM sessions
      WHERE sid = $1
      LIMIT 1`,
    [verified.sid]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (r.revoked) return null;
  if (!r.expires_at || new Date(r.expires_at) <= new Date()) return null;
  return r.user_id || null;
}

async function getUserSortPrefs(userId) {
  // Читаємо jsonb з user_preferences
  const { rows } = await pool.query(
    `SELECT data
       FROM user_preferences
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  const data = rows[0].data || {};
  const sort_col   = typeof data.sort_col === 'string'   ? data.sort_col   : null;
  const sort_order = typeof data.sort_order === 'string' ? data.sort_order : null;

  // Back-compat: єдиний рядок "sort":"kickoff_at_desc"
  if (!sort_col && typeof data.sort === 'string') {
    const m = /^([a-z_]+)_(asc|desc)$/i.exec(data.sort);
    if (m) return { sort_col: m[1].toLowerCase(), sort_order: m[2].toLowerCase() };
  }
  if (!sort_col || !sort_order) return null;
  return { sort_col: sort_col.toLowerCase(), sort_order: sort_order.toLowerCase() };
}

function buildOrderBy(sort_col, sort_order) {
  // Анти-SQLi: беремо лише з білого списку
  const col = ORDERABLE[sort_col] || ORDERABLE[DEFAULT_SORT_COL];
  const dir = sort_order === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${col} ${dir}, id ASC`; // другорядне стабілізуюче сортування
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { ok:false, error:'method_not_allowed' });
  }

  try {
    // 1) Поточний користувач (якщо є)
    let userId = null;
    try {
      userId = await getUserIdFromCookie(event);
    } catch {
      userId = null;
    }

    // 2) Обрати сортування
    let sort_col   = DEFAULT_SORT_COL;
    let sort_order = DEFAULT_SORT_DIR;

    if (userId) {
      const prefs = await getUserSortPrefs(userId);
      if (prefs && ORDERABLE[prefs.sort_col] && (prefs.sort_order === 'asc' || prefs.sort_order === 'desc')) {
        sort_col   = prefs.sort_col;
        sort_order = prefs.sort_order;
      }
    }

    const orderBy = buildOrderBy(sort_col, sort_order);

    // 3) Витягнути матчі
    const sql = `
      SELECT id, kickoff_at, league, status, home_team, away_team, tournament, rank, link
        FROM matches
       ${orderBy}
       LIMIT 500
    `;
    const { rows } = await pool.query(sql, []);

    return json(200, { ok:true, items: rows, sort_applied: { sort_col, sort_order } });
  } catch (e) {
    return json(500, { ok:false, error:'internal_error', detail: String(e?.message || e) });
  }
};
