const { getClient } = require('./_db');

exports.handler = async function(event) {
  const client = getClient();
  try {
    const { key, value } = JSON.parse(event.body || '{}');
    if (key !== 'seen_color') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported key' }) };
    }
    await client.connect();
    await client.query("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await client.query(
      "INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
      [key, String(value)]
    );
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  } finally {
    await client.end();
  }
};
