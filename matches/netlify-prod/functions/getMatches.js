// matches/netlify-prod/functions/getMatches.js
// Мікрокрок 18.4.0.8: адаптер до requireAuth для обох можливих сигнатур.
// Формат відповіді та SQL НЕ змінюємо.

const { requireAuth, corsHeaders } = require('./_utils');
const { getClient } = require('./_db');

// Твоя існуюча бізнес-логіка як окрема async-функція
async function coreGetMatches() {
  const client = getClient();
  try {
    await client.connect();

    // --- ПОЧАТОК: існуюча логіка без змін ---
    const p = await client.query("SELECT sort_col, sort_order FROM preferences LIMIT 1");

    let sortCol = 'date', sortOrder = 'asc';
    const allowed = ['rank','match','tournament','date','link','seen','comments'];
    if (p.rowCount) {
      const col = p.rows[0].sort_col;
      const ord = p.rows[0].sort_order;
      if (allowed.includes(col)) sortCol = col;
      if (ord === 'desc') sortOrder = 'desc';
    }

    const rows = await client.query(`
      SELECT rank, match, tournament, date, link, seen, comments
      FROM matches
      ORDER BY ${sortCol} ${sortOrder} NULLS LAST, rank ASC
    `);

    const matches = rows.rows.map(r => ({
      rank: r.rank,
      match: r.match,
      tournament: r.tournament,
      date: r.date instanceof Date ? r.date.toISOString().slice(0,10) : r.date,
      link: r.link,
      seen: r.seen,
      comments: r.comments
    }));

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ matches, sort: { column: sortCol, order: sortOrder } })
    };
    // --- КІНЕЦЬ: існуюча логіка ---
  } finally {
    await client.end();
  }
}

/**
 * Адаптер, що підтримує обидва варіанти реалізації requireAuth:
 * 1) HOF: requireAuth(handler) -> (event, context) => response
 * 2) Виклик із подією: requireAuth(event, context, handler) -> response
 */
function wrapAuth(handler) {
  try {
    const maybe = requireAuth(handler);
    if (typeof maybe === 'function') {
      // Варіант HOF — повертаємо обгорнуту функцію
      return maybe;
    }
    // Якщо це не функція — вважаємо, що requireAuth очікує (event, context, handler)
    return async (event, context) => {
      return await requireAuth(event, context, handler);
    };
  } catch (_e) {
    // Якщо requireAuth кидає помилку при такому виклику — теж вважаємо сигнатуру (event, context, handler)
    return async (event, context) => {
      return await requireAuth(event, context, handler);
    };
  }
}

// Обгортаємо coreGetMatches адаптером авторизації
const guarded = wrapAuth(async (event) => {
  // Якщо треба — event можна використовувати для більш тонкого контролю
  return await coreGetMatches();
});

// Експортуємо явний handler для Netlify
exports.handler = async function handler(event, context) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  try {
    const res = await guarded(event, context);
    // Гарантуємо CORS у відповіді
    const headers = { ...corsHeaders(), ...(res && res.headers ? res.headers : {}) };
    // Якщо guarded повернув тільки body/statusCode — зберемо відповідь коректно
    const statusCode = res && typeof res.statusCode === 'number' ? res.statusCode : 200;
    const body = res && typeof res.body !== 'undefined' ? res.body : JSON.stringify(res ?? {});
    return { statusCode, headers, body };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, error: String(e?.message || e) })
    };
  }
};
// --- КІНЕЦЬ getMatches.js ---