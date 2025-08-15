const { getClient } = require('./_db');
const ALLOWED = ['match','tournament','date','link','seen','comments'];

exports.handler = async function(event) {
  const client = getClient();
  try {
    const { column, order } = JSON.parse(event.body || '{}');
    if (!ALLOWED.includes(column) || !['asc','desc'].includes(order)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid sort parameters' }) };
    }
    await client.connect();
    await client.query("TRUNCATE preferences");
    await client.query("INSERT INTO preferences(sort_col, sort_order) VALUES ($1,$2)", [column, order]);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  } finally {
    await client.end();
  }
};
