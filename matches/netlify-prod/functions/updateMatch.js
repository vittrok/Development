const {
  pool,
  corsHeaders,
  handleOptions,
  isAllowedOrigin,
  verifyCsrf,
  rateLimit,
  safeJson,
  sanitizeComment,
  validDate
} = require('./_utils');

const { requireAuth } = require('./_auth');
exports.handler = requireAuth(async (event) => {
  // ... існуюча логіка + перевірка CSRF як і раніше
});

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') return handleOptions(event);

  // Only allow our site or same-origin requests
  if (!isAllowedOrigin(event)) {
    return { statusCode: 403, body: 'forbidden' };
  }

  const ip = event.headers['x-nf-client-connection-ip'] || '';
  const ua = event.headers['user-agent'] || '';
  const csrf = event.headers['x-csrf'];

  // Validate CSRF token bound to IP + UA
  if (!verifyCsrf(csrf, { ip, ua })) {
    return { statusCode: 401, headers: corsHeaders(), body: 'bad csrf' };
  }

  // Rate limit: max 60 mutations per 10 minutes per IP
  const { limited, remaining, reset } = await rateLimit(`mut:${ip}`, 60, 600);
  if (limited) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders(), 'Retry-After': Math.ceil((reset - new Date()) / 1000) },
      body: JSON.stringify({ error: 'rate_limited' }),
    };
  }

  // Parse and validate request body
  const body = safeJson(event.body);
  if (!body) {
    return { statusCode: 400, headers: corsHeaders(), body: 'invalid json' };
  }

  const { date, match, seen, comments } = body;
  if (!validDate(date) || typeof match !== 'string' || !match.trim()) {
    return { statusCode: 400, headers: corsHeaders(), body: 'invalid fields' };
  }

  const comm = comments == null ? null : sanitizeComment(comments);
  const seenVal = typeof seen === 'boolean' ? seen : null;

  try {
    await pool.query(
      `UPDATE matches
       SET seen = COALESCE($3, seen),
           comments = COALESCE($4, comments)
       WHERE date = $1 AND match = $2`,
      [date, match, seenVal, comm]
    );
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, remaining }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: String(e) }),
    };
  }
};
