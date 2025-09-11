// HOF: requireAuth(handler) -> (event, context) => response
// Узгоджено з архітектурою v1.1. Логи тільки під DEBUG_AUTH=true.

const { corsHeaders, parseCookies } = require('./_utils');
const { getSession } = require('./_session');

const DEBUG = process.env.DEBUG_AUTH === 'true';

function mask(val) {
  if (!val) return '';
  const s = String(val);
  if (s.length <= 12) return s[0] + '…' + s[s.length - 1];
  return s.slice(0, 8) + '…' + s.slice(-8);
}

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
  const combined = [single, multi, arr].filter(Boolean).join('; ');

  if (DEBUG) {
    const sessFromSingle = (single.match(/(?:^|;\s*)session=([^;]+)/i) || [,''])[1];
    const sessFromMulti  = (multi.match(/(?:^|;\s*)session=([^;]+)/i)  || [,''])[1];
    const sessFromArr    = (arr.match(/(?:^|;\s*)session=([^;]+)/i)    || [,''])[1];
    console.log('[auth] cookies: single.len=%d multi.count=%d arr.count=%d combined.len=%d',
      single ? single.length : 0,
      Array.isArray(mvList) ? mvList.length : 0,
      Array.isArray(event.cookies) ? event.cookies.length : 0,
      combined.length
    );
    console.log('[auth] session.from.single=%s multi=%s arr=%s',
      mask(sessFromSingle), mask(sessFromMulti), mask(sessFromArr)
    );
  }
  return combined;
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

    if (DEBUG) console.log('[auth] start method=%s path=%s', event?.httpMethod, event?.path || event?.rawUrl || '');

    const cookieHeader  = getCookieHeader(event);
    const sessionCookie = extractSessionCookie(cookieHeader);

    if (DEBUG) console.log('[auth] extracted.session=%s', mask(sessionCookie));

    const sess = sessionCookie ? await getSession(sessionCookie) : null;

    if (!sess) {
      if (DEBUG) console.log('[auth] getSession: NOT FOUND');
      return { statusCode: 401, headers: corsWithCookie(), body: 'unauthorized' };
    }

    if (DEBUG) console.log('[auth] getSession: OK role=%s sid=%s', sess.role, mask(sess.sid));

    // getSession() повертає { sid, role }
    event.auth = { sid: sess.sid, role: sess.role };
    const res = await handler(event, context);
    return { ...res, headers: { ...(res?.headers || {}), ...corsWithCookie() } };
  };
}

module.exports = { requireAuth };