// matches/netlify-prod/functions/_auth.js
// HOF: requireAuth(handler) -> (event, context) => response

const { corsHeaders, parseCookies } = require('./_utils');
const { getSession } = require('./_session');

const DEBUG = process.env.DEBUG_AUTH === 'true';

function corsWithCookie() {
  const h = corsHeaders();
  const key = Object.keys(h).find(k => k.toLowerCase() === 'access-control-allow-headers') || 'Access-Control-Allow-Headers';
  const v = h[key] ? String(h[key]) : 'Content-Type, X-Requested-With, X-CSRF';
  if (!/(\b|,)\s*Cookie\s*(,|$)/i.test(v)) h[key] = v + ', Cookie';
  else h[key] = v;
  return h;
}

function mask(val) {
  if (!val) return '';
  const s = String(val);
  if (s.length <= 12) return s[0] + '…' + s[s.length - 1];
  return s.slice(0, 8) + '…' + s.slice(-8);
}

/** Суцільний cookie-рядок з усіх можливих джерел Netlify */
function getCookieHeader(event) {
  if (!event) return '';
  const h  = event.headers || {};
  const mv = event.multiValueHeaders || {};

  const single = h.cookie || h.Cookie || '';
  const mvList = mv.cookie || mv.Cookie;
  const multi  = Array.isArray(mvList) && mvList.length > 0 ? mvList.join('; ') : '';
  const arr    = Array.isArray(event.cookies) && event.cookies.length > 0 ? event.cookies.join('; ') : '';

  const combined = [single, multi, arr].filter(Boolean).join('; ');

  if (DEBUG) {
    console.log('[auth] httpMethod=', event.httpMethod, 'path=', event.path || event.rawUrl || '');
    console.log('[auth] headers.cookie.len=', single ? single.length : 0);
    console.log('[auth] mv.cookie.count=', Array.isArray(mvList) ? mvList.length : 0);
    console.log('[auth] event.cookies.count=', Array.isArray(event.cookies) ? event.cookies.length : 0);
    console.log('[auth] combinedCookie.len=', combined.length);
    // УВАГА: самі значення не логимо повністю
    const sessFromSingle = (single.match(/(?:^|;\s*)session=([^;]+)/i) || [,''])[1];
    const sessFromMulti  = (multi.match(/(?:^|;\s*)session=([^;]+)/i)  || [,''])[1];
    const sessFromArr    = (arr.match(/(?:^|;\s*)session=([^;]+)/i)    || [,''])[1];
    console.log('[auth] session.single=', mask(sessFromSingle));
    console.log('[auth] session.multi =', mask(sessFromMulti));
    console.log('[auth] session.arr   =', mask(sessFromArr));
  }

  return combined;
}

/** Витягуємо значення session з cookie-рядка */
function extractSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;

  try {
    const m = parseCookies(cookieHeader);
    if (m && typeof m.session === 'string' && m.session.length > 0) {
      return m.session;
    }
  } catch (_) {}

  const re = /(?:^|;\s*)session=([^;]+)/i;
  const match = re.exec(cookieHeader);
  return match ? match[1] : null;
}

/** requireAuth(handler) */
function requireAuth(handler) {
  return async (event, context) => {
    if (event && event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsWithCookie() };
    }

    const cookieHeader = getCookieHeader(event);
    const sessionCookie = extractSessionCookie(cookieHeader);

    if (DEBUG) {
      console.log('[auth] extracted.session =', mask(sessionCookie));
    }

    const sess = sessionCookie ? await getSession(sessionCookie) : null;

    if (!sess) {
      if (DEBUG) console.log('[auth] getSession: NOT FOUND');
      return { statusCode: 401, headers: corsWithCookie(), body: 'unauthorized' };
    }

    if (DEBUG) {
      console.log('[auth] getSession: OK user_id=', sess.user_id, 'role=', sess.role);
    }

    event.auth = { userId: sess.user_id, role: sess.role };
    const res = await handler(event, context);
    return { ...res, headers: { ...(res?.headers || {}), ...corsWithCookie() } };
  };
}

module.exports = { requireAuth };
// --- КІНЕЦЬ ФАЙЛУ ---