// matches/netlify-prod/functions/_auth.js
// HOF: requireAuth(handler) -> (event, context) => response

const { corsHeaders, parseCookies } = require('./_utils');
const { getSession } = require('./_session');

/** Додаємо 'Cookie' до Allow-Headers (як у /me) */
function corsWithCookie() {
  const h = corsHeaders();
  const key = Object.keys(h).find(k => k.toLowerCase() === 'access-control-allow-headers') || 'Access-Control-Allow-Headers';
  const v = h[key] ? String(h[key]) : 'Content-Type, X-Requested-With, X-CSRF';
  if (!/(\b|,)\s*Cookie\s*(,|$)/i.test(v)) h[key] = v + ', Cookie';
  else h[key] = v;
  return h;
}

/** Формуємо суцільний cookie-рядок з усіх можливих джерел події Netlify */
function getCookieHeader(event) {
  if (!event) return '';

  const h  = event.headers || {};
  const mv = event.multiValueHeaders || {};
  const single = h.cookie || h.Cookie || '';

  let multi = '';
  const mvList = mv.cookie || mv.Cookie;
  if (Array.isArray(mvList) && mvList.length > 0) {
    multi = mvList.join('; ');
  }

  // Netlify іноді надає cookies як масив (event.cookies)
  let arr = '';
  if (Array.isArray(event.cookies) && event.cookies.length > 0) {
    arr = event.cookies.join('; ');
  }

  // Склеюємо джерела з роздільниками
  return [single, multi, arr].filter(Boolean).join('; ');
}

/** Витягуємо значення session з cookie-рядка */
function extractSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;

  // 1) Спроба через існуючий парсер
  try {
    const m = parseCookies(cookieHeader);
    if (m && typeof m.session === 'string' && m.session.length > 0) {
      return m.session;
    }
  } catch (_) { /* fallback нижче */ }

  // 2) Regex-фолбек (допускає відсутність пробілу після ';')
  const re = /(?:^|;\s*)session=([^;]+)/i;
  const match = re.exec(cookieHeader);
  return match ? match[1] : null;
}

/** requireAuth(handler) */
function requireAuth(handler) {
  return async (event, context) => {
    // CORS preflight
    if (event && event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsWithCookie() };
    }

    const cookieHeader = getCookieHeader(event);
    const sessionCookie = extractSessionCookie(cookieHeader);
    const sess = sessionCookie ? await getSession(sessionCookie) : null;

    if (!sess) {
      return { statusCode: 401, headers: corsWithCookie(), body: 'unauthorized' };
    }

    event.auth = { userId: sess.user_id, role: sess.role };
    const res = await handler(event, context);

    // гарантуємо CORS і в успішній відповіді
    return { ...res, headers: { ...(res?.headers || {}), ...corsWithCookie() } };
  };
}

module.exports = { requireAuth };
// --- КІНЕЦЬ ФАЙЛУ ---