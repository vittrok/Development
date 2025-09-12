// functions/getMatches.js
// Персоналізоване сортування за user_preferences (jsonb).
// Якщо користувач неавторизований або не знайдено префів — дефолт kickoff_at ASC.
//
// Додатково для діагностики повертаємо:
//  - auth_detected: чи вдалося знайти підписану сесію (sid)
//  - user_detected: чи знайшли user_id по sid
//
// Публічний доступ збережено (без сесії -> дефолтне сортування).
//
// Залежності: _utils.getPool, _utils.corsHeaders, _session.verifySigned/_session.extractSigned
//              (але маємо і запасний парсер cookie, якщо extractSigned щось не зʼїсть)

const { getPool, corsHeaders } = require('./_utils');
const { verifySigned, extractSigned } = require('./_session');

const pool = getPool();

// БІЛИЙ СПИСОК колонок для ORDER BY
const ORDERABLE = {
  kickoff_at : 'kickoff_at',
  rank       : 'rank',
  tournament : 'tournament',
  league     : 'league',
  status     : 'status',
  home_team  : 'home_team',
  away_team  : 'away_team',
};

const DEFAULT_SORT_COL = 'kickoff_at';
const DEFAULT_SORT_DIR = 'asc'; // 'asc' | 'desc'

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

// Бекап-парсер cookie -> signed value "session=<sid>.<sig>"
function extractSignedFromCookieHeader(event) {
  const h = event.headers || {};
  const cookie = h.cookie || h.Cookie || '';
  const m = String(cookie).match(/(?:^|;\s*)session=([^;]+)/i);
  return m ? m[1] : null; // "<sid>.<sig>"
}

async function getUserIdViaSid(sid) {
  const q = `
    SELECT user_id, revoked, expires_at
      FROM sessions
     WHERE sid = $1
     LIMIT 1
  `;
  const { rows } = await pool.query(q, [sid]);
  if (!rows.length) return null;
  const r = rows[0];
  if (r.revoked) return null;
  if (!r.expires_at || new Date(r.expires_at) <= new Date()) return null;
  return r.user_id || null;
}

async function getUserContext(event) {
  // 1) якщо колись обгорнемо requireAuth — воно кладе event.auth.sid
  if (event.auth && event.auth.sid) {
    const uid = await getUserIdViaSid(event.auth.sid);
    return { auth_detected: true, user_detected: !!uid, user_id: uid };
  }

  // 2) пробуємо штатний _session.extractSigned
  let signed = null;
  try { signed = extractSigned(event); } catch { signed = null; }

  // 3) якщо ні — парсимо cookie вручну
  if (!signed) signed = extractSignedFromCookieHeader(event);

  if (!signed) return { auth_detected: false, user_detected: false, user_id: null };

  // верифікуємо підпис і дістаємо sid
  const verified = verifySigned(signed); // { sid } | null
  if (!verified || !verified.sid) return { auth_detected: false, user_detected: false, user_id: null };

  const uid = await getUserIdViaSid(verified.sid);
  return { auth_detected: true, user_detected: !!uid, user_id: uid };
}

async function getUserSortPrefs(userId) {
  const { rows } = await pool.query(
    `SELECT data FROM user_preferences WHERE user_id=$1 LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  const data = rows[0].data || {};
  let sort_col   = typeof data.sort_col === 'string'   ? data.sort_col.toLowerCase()   : null;
  let sort_order = typeof data.sort_order === 'string' ? data.sort_order.toLowerCase() : null;

  // Back-compat: "sort":"kickoff_at_desc"
  if (!sort_col && typeof data.sort === 'string') {
    const m = /^([a-z_]+)_(asc|desc)$/i.exec(data.sort);
    if (m) { sort_col = m[1].toLowerCase(); sort_order = m[2].toLowerCase(); }
  }
  if (!sort_col || !sort_order) return null;
  return { sort_col, sort_order };
}

function buildOrderBy(sort_col, sort_order) {
  const col = ORDERABLE[sort_col] || ORDERABLE[DEFAULT_SORT_COL];
  const dir = (sort_order === 'desc') ? 'DESC' : 'ASC';
  return `ORDER BY ${col} ${dir}, id ASC`; // стабілізатор
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
    // 1) Витягнути контекст користувача
    const { auth_detected, user_detected, user_id } = await getUserContext(event);

    // 2) Визначити сортування
    let sort_col = DEFAULT_SORT_COL;
    let sort_order = DEFAULT_SORT_DIR;

    if (user_detected && user_id) {
      const prefs = await getUserSortPrefs(user_id);
      if (prefs && ORDERABLE[prefs.sort_col] && (prefs.sort_order === 'asc' || prefs.sort_order === 'desc')) {
        sort_col = prefs.sort_col;
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

    return json(200, {
      ok: true,
      items: rows,
      sort_applied: { sort_col, sort_order },
      // діагностика (тимчасово, не містить секретів)
      auth_detected,
      user_detected
    });
  } catch (e) {
    return json(500, { ok:false, error:'internal_error', detail: String(e?.message || e) });
  }
};
