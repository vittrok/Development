const { getClient } = require('./_db');

exports.handler = async function() {
  const client = getClient();
  try {
    await client.connect();
    // read sort
    const p = await client.query("SELECT sort_col, sort_order FROM preferences LIMIT 1");
    let sortCol = 'date', sortOrder = 'asc';
    const allowed = ['match','tournament','date','link','seen','comments'];
    if (p.rowCount) {
      const col = p.rows[0].sort_col;
      const ord = p.rows[0].sort_order;
      if (allowed.includes(col)) sortCol = col;
      if (ord === 'desc') sortOrder = 'desc';
    }
    const rows = await client.query(`SELECT match, tournament, date, link, seen, comments FROM matches ORDER BY ${sortCol} ${sortOrder}`);
    const matches = rows.rows.map(r => ({
      match: r.match,
      tournament: r.tournament,
      date: r.date instanceof Date ? r.date.toISOString().slice(0,10) : r.date,
      link: r.link,
      seen: r.seen,
      comments: r.comments
    }));
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matches, sort: { column: sortCol, order: sortOrder } })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  } finally {
    await client.end();
  }
};
