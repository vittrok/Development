// matches/netlify-prod/functions/_auth.js
// HOF: requireAuth(handler) -> (event, context) => response
// Єдина точка входу для перевірки сесії. Узгоджено з архітектурою v1.1.

const { corsHeaders, parseCookies } = require('./_utils');
const { getSession } = require('./_session');

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

    const cookies = parseCookies(event?.headers?.cookie || event?.headers?.Cookie || '');
    const signed = cookies['session'];
    const sess = signed ? await getSession(signed) : null;

    if (!sess) {
      return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
    }

    // збагачуємо подію корисним контекстом
    event.auth = { userId: sess.user_id, role: sess.role };
    return handler(event, context);
  };
}

module.exports = { requireAuth };
