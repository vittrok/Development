// functions/me.js
/* eslint-disable */
const { getSession } = require('./_session');

function allowedOrigin() {
  return process.env.APP_ORIGIN || 'https://football-m.netlify.app';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': allowedOrigin(),
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF',
  };
}

function json(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { ok: false, error: 'Method Not Allowed' });
  }

  try {
    const sess = await getSession(event); // перевіряє HMAC підпис і валідність у БД
    if (!sess) {
      return json(200, {
        ok: true,
        auth: { isAuthenticated: false, role: null, sid_prefix: null },
      });
    }

    const sid_prefix = String(sess.sid).slice(0, 8);
    return json(200, {
      ok: true,
      auth: { isAuthenticated: true, role: sess.role || 'user', sid_prefix },
    });
  } catch (e) {
    console.error('[me] error:', e);
    return json(500, { ok: false, error: 'Internal Server Error' });
  }
};
