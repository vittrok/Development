const { corsHeaders, parseCookies, clearCookie, revokeSession } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }
  try {
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
    const signed = cookies['session'];
    if (signed) {
      await revokeSession(signed);
    }
    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Set-Cookie': clearCookie('session') },
      body: JSON.stringify({ ok: true })
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: corsHeaders(), body: 'logout failed' };
  }
};
