// matches/netlify-prod/functions/_auth.js
const { corsHeaders, parseCookies } = require('./_utils');
const { getSession } = require('./_session');

function corsWithCookie() {
  const h = corsHeaders();
  const key = Object.keys(h).find(k => k.toLowerCase() === 'access-control-allow-headers') || 'Access-Control-Allow-Headers';
  const v = h[key] ? String(h[key]) : 'Content-Type, X-Requested-With, X-CSRF';
  if (!/(\b|,)\s*Cookie\s*(,|$)/i.test(v)) h[key] = v + ', Cookie';
  else h[key] = v;
  return h;
}

function getCookieHeader(event) {
  if (!event) return '';
  const h  = event.headers || {};
  const mv = event.multiValueHeaders || {};
  const single = h.cookie || h.Cookie || '';
  const mvList = mv.cookie || mv.Cookie;
  const multi  = Array.isArray(mvList) && mvList.length > 0 ? mvList.join('; ') : '';
  const arr    = Array.isArray(event.cookies) && event.cookies.length > 0 ? event.cookies.join('; ') : '';
  return [single, multi, arr].filter(Boolean).join('; ');
}

function extractSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  try {
    const m = parseCookies(cookieHeader);
    if (m && typeof m.session === 'string' && m.session.length > 0) return m.session;
  } catch {}
  const re = /(?:^|;\s*)session=([^;]+)/i;
  const match = re.exec(cookieHeader);
  return match ? match[1] : null;
}

function requireAuth(handler) {
  return async (event, context) => {
    if (event && event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsWithCookie() };
    }

    const cookieHeader = getCookieHeader(event);
    const sessionCookie = extractSessionCookie(cookieHeader);
    const sess = sessionCookie ? await getSession(sessionCookie) : null;

    if (!sess) {
      return { statusCode: 401, headers: corsWithCookie(), body: 'unauthorized' };
    }

    // _session.getSession() повертає { sid, role }
    event.auth = { sid: sess.sid, role: sess.role };
    const res = await handler(event, context);
    return { ...res, headers: { ...(res?.headers || {}), ...corsWithCookie() } };
  };
}

module.exports = { requireAuth };
// --- КІНЕЦЬ ФАЙЛУ ---