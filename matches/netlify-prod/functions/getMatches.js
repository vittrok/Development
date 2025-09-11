// matches/netlify-prod/functions/getMatches.js
// Мікрокрок 18.4.0.17: переводимо на HOF requireAuth з _auth.js.
// Бізнес-логіка та SQL — БЕЗ змін.

const { requireAuth } = require('./_auth');
const { corsHeaders } = require('./_utils');
const { getClient } = require('./_db');

// Окрема бізнес-функція без авторизаційної логіки
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

// Netlify: exports.handler = function
exports.handler = async function handler(event, context) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'method not allowed' };
  }

  try {
    // HOF: спочатку загортаємо бізнес-обробник під requireAuth,
    // потім викликаємо загорнутий.
    const authed = requireAuth(async (ev) => {
      // усередині — лише бізнес-логіка
      return await coreGetMatches();
    });

    const res = await authed(event, context);

    // додаємо CORS до відповіді
    return { ...res, headers: { ...corsHeaders(), ...(res.headers || {}) } };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, error: String(e?.message || e) })
    };
  }
};
// --- КІНЕЦЬ ФАЙЛУ ---