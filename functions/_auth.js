const { getPool, corsHeaders, setCookie, parseCookies, createSession, checkAndIncRateLimit, clientIp, userAgent } = require('./_utils');
const pool = getPool();


function requireAuth(handler) {
  return async (event) => {
    // preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders() };
    }
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
    const signed = cookies['session'];
    const sess = signed ? await getSession(signed) : null;
    if (!sess) {
      return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
    }
    event.auth = { userId: sess.user_id, role: sess.role };
    return handler(event);
  };
}

module.exports = { requireAuth };
