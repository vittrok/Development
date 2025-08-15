const { getClient } = require('./_db');

exports.handler = async function() {
  const client = getClient();
  try {
    await client.connect();
    const r = await client.query("SELECT sync_time, trigger_type, client_ip, new_matches, skipped_matches FROM sync_logs ORDER BY sync_time DESC LIMIT 100");
    return {
      statusCode: 200,
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({ logs: r.rows })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  } finally {
    await client.end();
  }
};
