// functions/me.js
/* eslint-disable */
const { corsHeaders, parseCookies, clientIp, userAgent, signCsrf } = require('./_utils');
const { getSession } = require('./_session');

exports.handler = async (event) => {
  // CORS preflight
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
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ authenticated: false }),
      };
    }

    // CSRF: HMAC із прив’язкою до IP/UA/часу (реалізація в _utils.signCsrf)
    const csrf = signCsrf({ ip: clientIp(event), ua: userAgent(event), ts: Date.now() });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        authenticated: true,
        role: sess.role || 'user',
        csrf,
      }),
    };
  } catch (e) {
    console.error('[/me] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'me failed' };
  }
};
