// functions/admin-check.js
/* eslint-disable */
const { corsHeaders, requireAdmin } = require('./_utils');

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  // Доступ тільки для admin
  const res = await requireAdmin(event);
  if (!res.session) return res; // 401 або 403 уже сформовані мідлваром

  const { user_id, username, role, sid } = res.session;
  return {
    statusCode: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ok: true, user: { id: user_id, username, role }, sid }),
  };
};
