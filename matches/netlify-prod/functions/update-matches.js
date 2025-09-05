// functions/update-matches.js
const {
  pool,
  corsHeaders,
  handleOptions,
  isAllowedOrigin,
  requireAdmin,
  rateLimit,
} = require('./_utils');

const { requireAuth } = require('./_auth');
exports.handler = requireAuth(async (event) => {
  // ... існуюча логіка + перевірка CSRF як і раніше
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions(event);
  if (!isAllowedOrigin(event)) return { statusCode: 403, body: 'forbidden' };
  if (!requireAdmin(event)) return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };

  const ip = event.headers['x-nf-client-connection-ip'] || 'admin';
  // Жорсткий ліміт: не частіше 1 раз/5 хв на IP
  const { limited, reset } = await rateLimit(`admin:sync:${ip}`, 1, 300);
  if (limited) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders(), 'Retry-After': Math.ceil((reset - new Date()) / 1000) },
      body: JSON.stringify({ error: 'rate_limited' }),
    };
  }

  try {
    const trigger = event.queryStringParameters?.trigger || 'manual';
    const client_ip = event.headers['x-nf-client-connection-ip'] || '';

    // TODO: підключити реальне джерело даних (CSV/API) і заповнити fetched[]
    const fetched = []; // [{date, match, tournament, link}, ...]
    let inserted = 0, skipped = 0;

    for (const m of fetched) {
      const res = await pool.query(
        `INSERT INTO matches(date, match, tournament, link)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (date, match) DO NOTHING
         RETURNING 1`,
        [m.date, m.match, m.tournament, m.link]
      );
      if (res.rowCount > 0) inserted++; else skipped++;
    }

    await pool.query(
      `INSERT INTO sync_logs(trigger_type, client_ip, new_matches, skipped_matches)
       VALUES ($1,$2,$3,$4)`,
      [trigger, client_ip, inserted, skipped]
    );

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, trigger, newMatches: inserted, skippedMatches: skipped }),
    };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: String(e) }) };
  }
};
