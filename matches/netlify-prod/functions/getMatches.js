const { requireAuth } = require('./_auth');
const { corsHeaders } = require('./_utils');
const { getClient } = require('./_db');

async function coreGetMatches() {
  const client = getClient();
  try {
    await client.connect();

    // існуюча логіка без змін
    const p = await client.query("SELECT sort_col, sort_order FROM preferences LIMIT 1");

    let sortCol = 'date', sortOrder = 'asc';
    const allowed = ['rank','match','tournament','date','link','seen','comments','kickoff_at'];
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
  } finally {
    await client.end();
  }
}

exports.handler = async function handler(event, context) {
  // БЕЗУМОВНА ДІАГНОСТИКА (getMatches)
  console.log('[gm] entry method=%s', event?.httpMethod);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'method not allowed' };
  }

  try {
    const authed = requireAuth(async () => {
      console.log('[gm] business start');
      return await coreGetMatches();
    });

    const res = await authed(event, context);
    return { ...res, headers: { ...corsHeaders(), ...(res.headers || {}) } };
  } catch (e) {
    console.log('[gm] error=%s', e && e.message ? e.message : String(e));
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, error: String(e?.message || e) })
    };
  }
};
// --- КІНЕЦЬ ФАЙЛУ ---