// matches/netlify-prod/functions/getMatches.js
// Мікрокрок 18.4.0.7: виправляємо інтеграцію requireAuth як HOF (як у /me).
// Формат відповіді та SQL ЛИШАЄМО без змін.

const { requireAuth, corsHeaders } = require('./_utils');
const { getClient } = require('./_db');

exports.handler = requireAuth(async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  const client = getClient();
  try {
    await client.connect();

    // --- твоя поточна логіка getMatches (без змін формату/SQL) ---
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
      headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ matches, sort: { column: sortCol, order: sortOrder } })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, error: String(e?.message || e) })
    };
  } finally {
    await client.end();
  }
});
