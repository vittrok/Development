// functions/me.js
/* eslint-disable */
const { getSession } = require('./_session');
const { signCsrf } = require('./_utils'); // архітектурні примітиви CSRF

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
    const sess = await getSession(event); // перевіряє HMAC і валідність у БД

    if (!sess) {
      // Анонімний користувач — CSRF не видаємо
      return json(200, {
        ok: true,
        auth: { isAuthenticated: false, role: null, sid_prefix: null },
        csrf: null,
      });
    }

    const sid_prefix = String(sess.sid).slice(0, 8);
    // ВАЖЛИВО: CSRF-пейлоад має містити ts (мітку часу), інакше verifyCsrf відхилить токен
    const csrfPayload = { sid: sess.sid, ts: Date.now() };
    const csrf = signCsrf(csrfPayload);

    return json(200, {
      ok: true,
      auth: { isAuthenticated: true, role: sess.role || 'user', sid_prefix },
      csrf,
    });
  } catch (e) {
    console.error('[me] error:', e);
    return json(500, { ok: false, error: 'Internal Server Error' });
  }
};
