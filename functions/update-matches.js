const { getClient } = require('./_db');

exports.handler = async function(event, context) {
  const client = getClient();
  const trigger = event.headers && event.headers['x-netlify-scheduled-event'] ? 'cron' : 'manual';
  const ip = (event.headers && (event.headers['x-forwarded-for'] || event.headers['client-ip'])) || '';

  try {
    await client.connect();

    // Placeholder for real sync (CSV/API). For now, just log an entry.
    const newMatches = 0;
    const skippedMatches = 0;

    await client.query(
      "INSERT INTO sync_logs(trigger_type, client_ip, new_matches, skipped_matches) VALUES ($1,$2,$3,$4)",
      [trigger, ip, newMatches, skippedMatches]
    );

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, trigger, newMatches, skippedMatches })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  } finally {
    await client.end();
  }
};
