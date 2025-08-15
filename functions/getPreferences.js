// functions/getPreferences.js
const {
  pool,
  corsHeaders,
  handleOptions,
  isAllowedOrigin,
  signCsrf,
} = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions(event);
  if (!isAllowedOrigin(event)) return { statusCode: 403, body: 'forbidden' };

  try {
    // settings: seen_color
    const res = await pool.query(`SELECT key, value FROM settings`);
    const prefs = Object.fromEntries(res.rows.map(r => [r.key, r.value]));

    // preferences: sort
    const sortRes = await pool.query(`SELECT sort_col, sort_order FROM preferences LIMIT 1`);
    const sort = sortRes.rows[0] || null;

    // CSRF (bind to IP + UA, TTL 2h)
    const ip = event.headers['x-nf-client-connection-ip'] || '';
    const ua = event.headers['user-agent'] || '';
    const csrf = signCsrf({ ip, ua, ts: Date.now() });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        seen_color: prefs.seen_color || null,
        sort,
        csrf,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: String(e) }),
    };
  }
};
