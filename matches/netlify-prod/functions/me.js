const { corsHeaders, parseCookies, getSession, userAgent, clientIp, signCsrf } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }
  try {
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
    const signed = cookies['session'];
    const sess = signed ? await getSession(signed) : null;

    if (!sess) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ authenticated: false }) };
    }

    // видаємо CSRF, прив’язуючи до ip+ua+часу (твоя наявна HMAC-реалізація)
    const csrf = signCsrf({ ip: clientIp(event), ua: userAgent(event), ts: Date.now() });
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ authenticated: true, role: sess.role, csrf })
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: corsHeaders(), body: 'me failed' };
  }
};
