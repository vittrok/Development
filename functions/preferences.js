// functions/preferences.js

// === УТИЛІТИ ТА ЗАЛЕЖНОСТІ (залиште ваші реальні імпорти як є) ===
const { getSessionFromEvent } = require('./_session');   // ваша реалізація
const { requireOrigin, requireCsrf } = require('./_auth'); // ваша реалізація
const { getDb } = require('./_db');                        // ваша реалізація

// Дозволені ключі user_preferences.data
const ALLOWED_KEYS = new Set([
  'sort', 'sort_col', 'sort_order', 'seen_color', 'filters'
]);

// Допоміжний глибокий мердж для простих об’єктів
function deepMerge(target, src) {
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        target[k] = deepMerge(target[k] ?? {}, v);
      } else {
        target[k] = v;
      }
    }
    return target;
  }
  return src;
}

// НОРМАЛІЗОВАНИЙ парсер JSON-тіла
function parseJsonBody(event) {
  // Деякі клієнти шлють "application/json; charset=utf-8"
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
  const isJson = ct.startsWith('application/json');

  if (!isJson) return null; // нехай інші гілки (FORM) обробляються окремо

  let raw = event.body;
  if (event.isBase64Encoded) {
    try {
      raw = Buffer.from(raw || '', 'base64').toString('utf8');
    } catch (e) {
      throw new Error('invalid_base64_body');
    }
  }
  if (typeof raw !== 'string') {
    // На Netlify event.body має бути рядком; якщо ні — помилка формату
    throw new Error('invalid_json_body_type');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid_json_body');
  }
}

// Простий парсер x-www-form-urlencoded
function parseFormBody(event) {
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
  const isForm = ct.startsWith('application/x-www-form-urlencoded');
  if (!isForm) return null;

  let raw = event.body || '';
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, 'base64').toString('utf8');
  }
  const out = {};
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    const key = decodeURIComponent(k || '').trim();
    const val = decodeURIComponent(v || '').trim();
    if (key) out[key] = val;
  }
  return out;
}

// Відповідь + CORS заголовки
function okJson(body, origin) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF, Cookie',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    },
    body: JSON.stringify(body),
  };
}
function errText(status, msg, origin) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF, Cookie',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    },
    body: msg,
  };
}

exports.handler = async (event, context) => {
  const APP_ORIGIN = process.env.APP_ORIGIN;

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': APP_ORIGIN,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF, Cookie',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      },
      body: '',
    };
  }

  // Перевірки Origin/Session/CSRF (як у вас заведено)
  const originCheck = requireOrigin(event, APP_ORIGIN);
  if (!originCheck.ok) {
    return errText(403, 'forbidden origin', APP_ORIGIN);
  }
  const sess = await getSessionFromEvent(event);
  if (!sess?.userId) {
    return errText(401, 'unauthorized', APP_ORIGIN);
  }

  if (event.httpMethod === 'GET') {
    // Витягнути preferences.data з БД
    const db = await getDb();
    const row = await db.oneOrNone(
      `select data from user_preferences where user_id = $1`,
      [sess.userId]
    );
    const data = row?.data || {};
    return okJson({ ok: true, data }, APP_ORIGIN);
  }

  if (event.httpMethod === 'POST') {
    // CSRF
    const csrf = requireCsrf(event, sess);
    if (!csrf.ok) {
      return errText(401, 'csrf invalid', APP_ORIGIN);
    }

    // Тіло: пробуємо JSON, інакше FORM
    let patch = null;
    try {
      patch = parseJsonBody(event);
    } catch (e) {
      if (e.message === 'invalid_base64_body' || e.message === 'invalid_json_body' || e.message === 'invalid_json_body_type') {
        return errText(400, 'Invalid JSON body', APP_ORIGIN);
      }
      return errText(400, 'Bad Request', APP_ORIGIN);
    }
    if (patch == null) {
      // Не JSON — пробуємо FORM
      patch = parseFormBody(event);
      if (patch == null) {
        return errText(415, 'Unsupported Media Type', APP_ORIGIN);
      }
    }

    // White-list: прибираємо невідомі ключі
    const sanitized = {};
    for (const k of Object.keys(patch)) {
      if (ALLOWED_KEYS.has(k)) sanitized[k] = patch[k];
    }
    // Якщо прийшли внутрішні під-об’єкти (напр. filters), дозволяємо як є

    const db = await getDb();

    // Читаємо поточні
    const row = await db.oneOrNone(
      `select data from user_preferences where user_id = $1`,
      [sess.userId]
    );
    const current = row?.data || {};

    // Мерджимо
    const merged = deepMerge({ ...current }, sanitized);

    // UPSERT
    await db.none(
      `
      insert into user_preferences (user_id, data, created_at, updated_at)
      values ($1, $2::jsonb, now(), now())
      on conflict (user_id)
      do update set data = EXCLUDED.data, updated_at = now()
      `,
      [sess.userId, merged]
    );

    return okJson({ ok: true, data: merged }, APP_ORIGIN);
  }

  return errText(405, 'method not allowed', APP_ORIGIN);
};
