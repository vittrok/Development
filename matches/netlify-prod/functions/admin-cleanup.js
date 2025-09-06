// functions/admin-cleanup.js
/* eslint-disable */
const { corsHeaders, getPool, requireAdmin, requireCsrf } = require('./_utils');

const pool = getPool();

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  // лише для admin
  const auth = await requireAdmin(event);
  if (!auth.session) return auth;

  // CSRF обов’язково
  const deny = requireCsrf(event);
  if (deny) return deny;

  try {
    const r1 = await pool.query(`DELETE FROM sessions WHERE expires_at < now() RETURNING sid`);
    const r2 = await pool.query(`DELETE FROM rate_limits WHERE reset_at < now() RETURNING key`);

    const res = {
      ok: true,
      deleted: {
        sessions: r1.rowCount || 0,
        rate_limits: r2.rowCount || 0,
      },
    };

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(res),
    };
  } catch (e) {
    console.error('[/admin-cleanup] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'cleanup failed' };
  }
};
