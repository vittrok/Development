// HOF: requireAuth(handler) -> (event, context) => response
const { corsHeaders, parseCookies } = require('./_utils');
const { getSession } = require('./_session');

// маскуємо значення (без секретів у логах)
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

// об’єднуємо всі можливі носії куки
function getCookieHeader(event) {
  const h  = event?.headers || {};
  const mv = event?.multiValueHeaders || {};
  const single = h.cookie || h.Cookie || '';
  const mvList = mv.cookie || mv.Cookie;
  const multi  = Array.isArray(mvList) && mvList.length > 0 ? mvList.join('; ') : '';
  const arr    = Array.isArray(event?.cookies) && event.cookies.length > 0 ? event.cookies.join('; ') : '';
  const combined = [single, multi, arr].filter(Boolean).join('; ');

  // БЕЗУМОВНА ДІАГНОСТИКА (_auth)
  const sessSingle = (single.match(/(?:^|;\s*)session=([^;]+)/i) || [,''])[1];
  const sessMulti  = (multi.match(/(?:^|;\s*)session=([^;]+)/i)  || [,''])[1];
  const sessArr    = (arr.match(/(?:^|;\s*)session=([^;]+)/i)    || [,''])[1];
  console.log('[auth] cookies: single.len=%d multi.count=%d arr.count=%d combined.len=%d',
    single ? single.length : 0,
    Array.isArray(mvList) ? mvList.length : 0,
    Array.isArray(event?.cookies) ? event.cookies.length : 0,
    combined.length
  );
  console.log('[auth] session.from.single=%s multi=%s arr=%s',
    mask(sessSingle), mask(sessMulti), mask(sessArr)
  );

  return combined;
}

function extractSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  try {
    const m = parseCookies(cookieHeader);
    if (m && typeof m.session === 'string' && m.session.length > 0) return m.session;
  } catch (_) {}
  const re = /(?:^|;\s*)session=([^;]+)/i;
  const match = re.exec(cookieHeader);
  return match ? match[1] : null;
}

function requireAuth(handler) {
  return async (event, context) => {
    if (event?.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsWithCookie() };
    }

    console.log('[auth] start method=%s path=%s', event?.httpMethod, event?.path || event?.rawUrl || '');

    const cookieHeader = getCookieHeader(event);
    const sessionCookie = extractSessionCookie(cookieHeader);
    console.log('[auth] extracted.session=%s', mask(sessionCookie));

    const sess = sessionCookie ? await getSession(sessionCookie) : null;

    if (!sess) {
      console.log('[auth] getSession: NOT FOUND');
      return { statusCode: 401, headers: corsWithCookie(), body: 'unauthorized' };
    }

    console.log('[auth] getSession: OK user_id=%s role=%s', sess.user_id, sess.role);

    event.auth = { userId: sess.user_id, role: sess.role };
    const res = await handler(event, context);
    return { ...res, headers: { ...(res?.headers || {}), ...corsWithCookie() } };
  };
}

module.exports = { requireAuth };
// --- КІНЕЦЬ ФАЙЛУ ---