// functions/setSort.js
const {
  pool,
  corsHeaders,
  handleOptions,
  isAllowedOrigin,
  requireAdmin,
  safeJson,
  rateLimit,
} = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return handleOptions(event);
  if (!isAllowedOrigin(event)) return { statusCode: 403, body: 'forbidden' };
  if (!requireAdmin(event)) return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };

  // (не обов’язково, але корисно) трішки притиснемо активність адміна
  const ip = event.headers['x-nf-client-connection-ip'] || 'admin';
  const { limited, reset } = await rateLimit(`admin:setSort:${ip}`, 20, 600); // 20 разів/10 хв
  if (limited) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders(), 'Retry-After': Math.ceil((reset - new Date()) / 1000) },
      body: JSON.stringify({ error: 'rate_limited' }),
    };
  }

  const body = safeJson(event.body);
  if (!body) return { statusCode: 400, headers: corsHeaders(), body: 'invalid json' };

  const { column, order } = body;
  const allowedCols = new Set(['rank','match','tournament','date','link','seen','comments']);
  const allowedOrder = new Set(['asc','desc']);
  if (!allowedCols.has(column) || !allowedOrder.has(order)) {
    return { statusCode: 400, headers: corsHeaders(), body: 'invalid fields' };
  }

  try {
    // UPDATE якщо рядок є; якщо ні — INSERT
    const up = await pool.query(
      `UPDATE preferences SET sort_col=$1, sort_order=$2`,
      [column, order]
    );
    if (up.rowCount === 0) {
      await pool.query(
        `INSERT INTO preferences(sort_col, sort_order) VALUES ($1,$2)`,
        [column, order]
      );
    }
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: String(e) }) };
  }
};
