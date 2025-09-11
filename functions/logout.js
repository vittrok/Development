// functions/logout.js
// Перекладено на HOF requireAuth з ./_auth (18.4.0.18c).
// CSRF і CORS залишаються як уніфіковані утиліти з _utils.

const { requireAuth } = require('./_auth');
const { corsHeaders, requireCsrf, getPool } = require('./_utils');

const pool = getPool();

async function doLogout(event) {
  // Метод
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'method not allowed' };
  }

  // CSRF перевірка (кине 403 при невдалому сценарії усередині)
  const csrfOk = await requireCsrf(event);
  if (!csrfOk) {
    return { statusCode: 403, headers: corsHeaders(), body: 'forbidden' };
  }

  // Авторизований контекст з HOF: event.auth = { sid, role }
  const sid = event?.auth?.sid;
  if (!sid) {
    return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
  }

  try {
    // Відкликати сесію
    await pool.query(
      `UPDATE sessions SET revoked = true, revoked_at = NOW()
       WHERE sid = $1 AND revoked = false`,
      [sid]
    );

    // Погасити cookie (SameSite=Lax; Secure; HttpOnly)
    const expired = 'session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        'Set-Cookie': expired,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ ok: true })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, error: String(e?.message || e) })
    };
  }
}

// Експорт через HOF — авторизація виконується до бізнес-логіки:
exports.handler = requireAuth(doLogout);
