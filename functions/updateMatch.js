const { getClient } = require('./_db');

exports.handler = async function(event) {
  const client = getClient();
  try {
    const payload = JSON.parse(event.body || '{}');
    const { date, match, seen, comments } = payload;
    if (!date || !match) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing date or match' }) };
    }
    await client.connect();
    if (typeof seen === 'boolean' && typeof comments === 'string') {
      await client.query("UPDATE matches SET seen=$1, comments=$2 WHERE date=$3 AND match=$4", [seen, comments, date, match]);
    } else if (typeof seen === 'boolean') {
      await client.query("UPDATE matches SET seen=$1 WHERE date=$2 AND match=$3", [seen, date, match]);
    } else if (typeof comments === 'string') {
      await client.query("UPDATE matches SET comments=$1 WHERE date=$2 AND match=$3", [comments, date, match]);
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Nothing to update' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  } finally {
    await client.end();
  }
};
