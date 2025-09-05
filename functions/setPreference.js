const {
  pool,
  corsHeaders,
  handleOptions,
  isAllowedOrigin,
  verifyCsrf,
  rateLimit,
  safeJson,
} = require('./_utils');

const { requireAuth } = require('./_auth');
exports.handler = requireAuth(async (event) => {
  // ... існуюча логіка + перевірка CSRF як і раніше
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions(event);
  if (!isAllowedOrigin(event)) return { statusCode: 403, body: 'forbidden' };

  const ip = event.headers['x-nf-client-connection-ip'] || '';
  const ua = event.headers['user-agent'] || '';
  const csrf = event.headers['x-csrf'];

  if (!verifyCsrf(csrf, { ip, ua })) {
    return { statusCode: 401, headers: corsHeaders(), body: 'bad csrf' };
  }

  // 30 змін за 10 хв з одного IP
  const { limited, reset } = await rateLimit(`pref:${ip}`, 30, 600);
  if (limited) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders(), 'Retry-After': Math.ceil((reset - new Date()) / 1000) },
      body: JSON.stringify({ error: 'rate_limited' }),
    };
  }

  const body = safeJson(event.body);
  if (!body) return { statusCode: 400, headers: corsHeaders(), body: 'invalid json' };

  const { key, value } = body;

  // дозволяємо лише seen_color
  if (key !== 'seen_color' || typeof value !== 'string' || value.length > 30) {
    return { statusCode: 400, headers: corsHeaders(), body: 'invalid fields' };
  }

  // приймаємо #rgb/#rrggbb або невеликий whitelist назв
  const okHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  const okName = /^(?:red|green|blue|yellow|orange|purple|pink|lightyellow|lightpink|lightgreen|lightblue|lightgray|lightcyan|lightcoral|lightgoldenrodyellow|gray|grey|white|black)$/i.test(value);
  if (!okHex && !okName) {
    return { statusCode: 400, headers: corsHeaders(), body: 'invalid color' };
  }

  try {
    await pool.query(
      `INSERT INTO settings(key, value)
       VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [key, value]
    );
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: String(e) }) };
  }
};
