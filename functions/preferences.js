// File: functions/preferences.js
// Мінімальна робоча версія з коректним експортом handler,
// щоб зняти 502 "handler is undefined". Далі нарощуватимемо логіку за v1.1.
//
// Поведінка:
// - OPTIONS → 204 + CORS
// - GET     → 200 { ok: true, data: {} }  (тимчасово пусто; не суперечить архітектурі, дані додамо на наступних кроках)
// - POST    → 200 { ok: true }            (тимчасова заглушка; підтверджує прийом)
//
// ВАЖЛИВО: без хардкоду логін/пароль; без зміни БД.
// Це лише відновлення працездатності ендпойнта.

const ALLOWED_ORIGIN = 'https://football-m.netlify.app';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF',
    Vary: 'Origin',
  };
}

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      ...corsHeaders(ALLOWED_ORIGIN),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify(body),
  };
}

function noContent() {
  return {
    statusCode: 204,
    headers: {
      ...corsHeaders(ALLOWED_ORIGIN),
      'Cache-Control': 'no-cache',
    },
    body: '',
  };
}

exports.handler = async function handler(event /*, context */) {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return noContent();
    }

    // Тимчасово дозволяємо лише прод-оріджин
    const origin = event.headers?.origin || event.headers?.Origin || '';
    if (origin && origin !== ALLOWED_ORIGIN) {
      // Для простоти: відповідаємо 403, щоби явно не плутатись
      return json(403, { ok: false, error: 'forbidden_origin' });
    }

    if (event.httpMethod === 'GET') {
      // TODO(next steps): зчитати preferences з БД за session
      return json(200, { ok: true, data: {} });
    }

    if (event.httpMethod === 'POST') {
      // TODO(next steps): валідувати X-CSRF, змерджити data у БД
      // Переконаємося, що це валідний JSON (щоб уникнути 500 при кривому body)
      try {
        if (event.body && typeof event.body === 'string') {
          JSON.parse(event.body);
        }
      } catch {
        return json(400, { ok: false, error: 'invalid_json' });
      }
      return json(200, { ok: true });
    }

    return json(405, { ok: false, error: 'method_not_allowed' });
  } catch (e) {
    return json(500, { ok: false, error: 'internal_error', detail: String(e && e.message || e) });
  }
};
