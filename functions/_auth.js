// matches/netlify-prod/functions/_auth.js
// HOF: requireAuth(handler) -> (event, context) => response
// Єдина точка входу для перевірки сесії. Узгоджено з архітектурою v1.1.

const { corsHeaders, parseCookies } = require('./_utils');
const { getSession } = require('./_session');

/**
 * Формує єдиний рядок cookie із headers + multiValueHeaders
 */
function getCookieHeader(event) {
  if (!event) return '';

  const h = event.headers || {};
  const mv = event.multiValueHeaders || {};

  // Стандартний шлях
  const single = h.cookie || h.Cookie || '';

  // Якщо є мульти-значення — склеюємо
  let multi = '';
  const mvList = mv.cookie || mv.Cookie;
  if (Array.isArray(mvList) && mvList.length > 0) {
    // Склеюємо через "; " щоб не зламати парсер
    multi = mvList.join('; ');
  }

  if (single && multi) return `${single}; ${multi}`;
  return single || multi || '';
}

/**
 * Витягує значення session з рядка Cookie
 */
function extractSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;

  // 1) Спроба через існуючий парсер
  try {
    const m = parseCookies(cookieHeader);
    if (m && typeof m.session === 'string' && m.session.length > 0) {
      return m.session;
    }
  } catch (_) {
    // fallback нижче
  }

  // 2) Regex-фолбек (допускає відсутність пробілу після ';')
  const re = /(?:^|;\s*)session=([^;]+)/i;
  const match = re.exec(cookieHeader);
  return match ? match[1] : null;
}

/**
 * requireAuth(handler)
 */
function requireAuth(handler) {
  return async (event, context) => {
    // CORS preflight
    if (event && event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders() };
    }

    const cookieHeader = getCookieHeader(event);
    const sessionCookie = extractSessionCookie(cookieHeader);

    const sess = sessionCookie ? await getSession(sessionCookie) : null;

    if (!sess) {
      return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
    }

    event.auth = { userId: sess.user_id, role: sess.role };
    return handler(event, context);
  };
}

module.exports = { requireAuth };
// --- КІНЕЦЬ ФАЙЛУ ---