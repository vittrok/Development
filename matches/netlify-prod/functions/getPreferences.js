const { getClient } = require('./_db');

exports.handler = async function() {
  const client = getClient();
  try {
    await client.connect();

    let seenColor = 'lightyellow';
    const s = await client.query("SELECT value FROM settings WHERE key='seen_color' LIMIT 1");
    if (s.rowCount) seenColor = s.rows[0].value;

    let sort = { column: 'date', order: 'asc' };
    const p = await client.query("SELECT sort_col, sort_order FROM preferences LIMIT 1");
    if (p.rowCount) {
      const allowed = ['rank','match','tournament','date','link','seen','comments'];
      const col = allowed.includes(p.rows[0].sort_col) ? p.rows[0].sort_col : 'date';
      const ord = p.rows[0].sort_order === 'desc' ? 'desc' : 'asc';
      sort = { column: col, order: ord };
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seen_color: seenColor, sort })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  } finally {
    await client.end();
  }
};
