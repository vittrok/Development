// matches/netlify-prod/functions/getMatches.js
// Мікрокрок 18.4.0.7: Гарантуємо, що експортується ФУНКЦІЯ handler.
// Формат відповіді та SQL НЕ змінюємо. Логіка як у твоєму поточному коді.

const { requireAuth, corsHeaders } = require('./_utils');
const { getClient } = require('./_db');

// Твоя поточна бізнес-логіка як окрема async-функція
async function coreGetMatches() {
  const client = getClient();
  try {
    await client.connect();

    // --- ПОЧАТОК: існуюча у тебе логіка без змін ---
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
    // --- КІНЕЦЬ: існуюча у тебе логіка ---
  } finally {
    await client.end();
  }
}

// Створюємо guard-функцію через requireAuth (HOF)
const guarded = requireAuth(async (event) => {
  // тут уже буде перевірка сесії всередині requireAuth
  return await coreGetMatches();
});

// Експортуємо ЯВНУ функцію handler (це важливо для Netlify)
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
    // додамо CORS до будь-якої відповіді
    return { ...res, headers: { ...corsHeaders(), ...(res.headers || {}) } };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, error: String(e?.message || e) })
    };
  }
};
// --- КІНЕЦЬ getMatches.js ---