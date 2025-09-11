// matches/netlify-prod/functions/_auth.js
// HOF: requireAuth(handler) -> (event, context) => response
// Єдина точка входу для перевірки сесії. Узгоджено з архітектурою v1.1.

const { corsHeaders, parseCookies } = require('./_utils');
const { getSession } = require('./_session');

/**
 * Надійно витягує cookie заголовок та значення "session"
 */
function getCookieHeader(headers) {
  if (!headers) return '';
  // Netlify зазвичай дає все нижнім регістром, але про всяк:
  return headers.cookie || headers.Cookie || '';
}

function extractSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;

  // 1) Спроба через існуючий парсер
  try {
    const m = parseCookies(cookieHeader);
    if (m && typeof m.session === 'string' && m.session.length > 0) {
      return m.session;
    }
  } catch (_) {
    // ігноруємо — підстрахуємось regex-добуванням нижче
  }

  // 2) Надійний regex-фолбек (допускає відсутність пробілу після ';')
  const re = /(?:^|;\s*)session=([^;]+)/i;
  const match = re.exec(cookieHeader);
  return match ? match[1] : null;
}

/**
 * requireAuth(handler)
 *  - якщо немає валідної сесії -> 401
 *  - якщо є -> додаємо event.auth = { userId, role } і викликаємо handler(event, context)
 */
function requireAuth(handler) {
  return async (event, context) => {
    // CORS preflight тут же, щоб HOF був самодостатнім
    if (event && event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders() };
    }

    const cookieHeader = getCookieHeader(event?.headers);
    const sessionCookie = extractSessionCookie(cookieHeader);

    const sess = sessionCookie ? await getSession(sessionCookie) : null;

    if (!sess) {
      return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
    }

    // збагачуємо подію корисним контекстом
    event.auth = { userId: sess.user_id, role: sess.role };
    return handler(event, context);
  };
}

module.exports = { requireAuth };
// --- КІНЕЦЬ ФАЙЛУ ---