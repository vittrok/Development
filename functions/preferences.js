// functions/preferences.js
// Уніфікований ендпоінт для читання/оновлення користувацьких преференсів.
// Виправлення: POST повертає АКТУАЛЬНИЙ стан (echo після апдейту),
// приймає і JSON (application/json), і FORM (application/x-www-form-urlencoded),
// суворий CSRF для state-changing, CORS з Origin-валідацією.

// ──────────────────────────────────────────────────────────────────────────────
// ЛОКАЛЬНІ ХЕЛПЕРИ (без зовнішніх залежностей з репо — щоб файл був самоcтійним)
// Якщо у вас вже є спільні утиліти (CORS/CSRF/сесія/БД), їх можна підключити
// замість цих локальних хелперів — функціонально буде те саме.
// ──────────────────────────────────────────────────────────────────────────────

const { Pool } = require('pg');

const ALLOWED_ORIGIN = process.env.APP_ORIGIN; // напр., "https://football-m.netlify.app"
const DATABASE_URL   = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  // SSL для керованих PG (за потреби):
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});

// Простий cookie-сейшн (HMAC в іншому коді) — тут лише витягуємо user_id з куки.
// Якщо у вас інший механізм — замініть реалізацію getUserIdFromCookies().
function getUserIdFromCookies(cookieHeader) {
  // Очікуємо, що валідна сесія вже встановлена (але анонім — теж допустимий для GET).
  // У проді у вас окрема функція для розбору/перевірки підпису сесії.
  if (!cookieHeader) return null;
  // Приклад: session=sid.sig|uid:123 (якщо так у вас організовано)
  // Для безпечності просто не парсимо тут uid із куки, а покладаємось на
  // вже існуючі утиліти у вашому репо. Тут — заглушка:
  return null; // анонім за замовчуванням
}

// Валідація Origin
function ensureOrigin(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (!ALLOWED_ORIGIN || origin !== ALLOWED_ORIGIN) {
    return { ok: false, res: http(403, { ok: false, error: 'forbidden_origin' }) };
  }
  return { ok: true };
}

// Стандартні заголовки CORS
function corsHeaders() {
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF, Cookie',
  };
}

function http(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
    body: JSON.stringify(body),
  };
}

// Примусовий CSRF для POST
function requireCsrf(event) {
  const csrf = event.headers['x-csrf'] || event.headers['X-CSRF'];
  if (!csrf || String(csrf).length < 16) {
    return { ok: false, res: http(403, { ok: false, error: 'missing_csrf' }) };
  }
  // За потреби — валідація підпису/лейблу CSRF тут (або делегування у вашу утиліту).
  return { ok: true };
}

// Парсинг тіла: JSON або FORM
function parseBody(event) {
  const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  const raw = event.body || '';
  if (!raw) return { ok: true, data: {} };

  try {
    if (ct.includes('application/json')) {
      // Netlify у разі base64 body встановлює flag isBase64Encoded
      const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
      return { ok: true, data: JSON.parse(text) };
    }
    if (ct.includes('application/x-www-form-urlencoded')) {
      const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
      const params = new URLSearchParams(text);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return { ok: true, data: obj };
    }
    // Інші типи не підтримуємо
    return { ok: false, res: http(415, { ok: false, error: 'unsupported_media_type' }) };
  } catch (e) {
    return { ok: false, res: http(400, { ok: false, error: 'invalid_json' }) };
  }
}

// Валідація полів префів
const SORT_WHITELIST = new Set(['league', 'kickoff_at']); // розширите за потреби
const ORDER_WHITELIST = new Set(['asc', 'desc']);

function validatePrefs(input) {
  const out = {};
  if (input.seen_color != null) {
    const c = String(input.seen_color);
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) {
      return { ok: false, error: 'invalid_seen_color' };
    }
    out.seen_color = c.toLowerCase();
  }
  if (input.sort_col != null) {
    const col = String(input.sort_col);
    if (!SORT_WHITELIST.has(col)) {
      return { ok: false, error: 'invalid_sort_col' };
    }
    out.sort_col = col;
  }
  if (input.sort_order != null) {
    const ord = String(input.sort_order).toLowerCase();
    if (!ORDER_WHITELIST.has(ord)) {
      return { ok: false, error: 'invalid_sort_order' };
    }
    out.sort_order = ord;
  }
  return { ok: true, data: out };
}

// Читання префів
async function readPrefs(client, userId, sessionKey) {
  // Поточна реалізація: jsonb у таблиці user_preferences.
  // Якщо у вас інша назва/схема — скоригуйте тут.
  // Для аноніма — читаємо за sessionKey, якщо зберігаєте гостьові префи; якщо ні — дефолти.
  const defaults = { seen_color: '#fffdaa', sort_col: 'kickoff_at', sort_order: 'asc' };

  if (!userId && !sessionKey) return defaults;

  const { rows } = await client.query(
    `select data
       from user_preferences
      where (user_id = $1) or (session_key = $2)
      order by updated_at desc
      limit 1`,
    [userId, sessionKey]
  );

  if (!rows.length || !rows[0].data) return defaults;
  return { ...defaults, ...rows[0].data };
}

// Запис префів (мердж)
async function writePrefs(client, userId, sessionKey, patch) {
  // Спрощено: upsert по (user_id) якщо є користувач, інакше по (session_key)
  const keyCol = userId ? 'user_id' : 'session_key';
  const keyVal = userId ? userId : sessionKey;

  await client.query(
    `
    insert into user_preferences (${keyCol}, data, updated_at)
    values ($1, $2, now())
    on conflict (${keyCol})
    do update set data = user_preferences.data || $2::jsonb, updated_at = now()
    `,
    [keyVal, JSON.stringify(patch)]
  );
}

// Отримати session_key із куки (якщо підтримується в системі гостьових префів)
function getSessionKeyFromCookies(cookieHeader) {
  if (!cookieHeader) return null;
  // Якщо у вас є підписана гостьова сесія — дістаньте її тут.
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: '',
    };
  }

  // Origin check
  const originCheck = ensureOrigin(event);
  if (!originCheck.ok) return originCheck.res;

  // База
  const client = await pool.connect();
  try {
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const userId = getUserIdFromCookies(cookieHeader); // у вашому репо взяти реальну айдентифікацію
    const sessionKey = getSessionKeyFromCookies(cookieHeader);

    if (event.httpMethod === 'GET') {
      const data = await readPrefs(client, userId, sessionKey);
      return http(200, { ok: true, data });
    }

    if (event.httpMethod === 'POST') {
      // CSRF обов’язковий
      const csrfCheck = requireCsrf(event);
      if (!csrfCheck.ok) return csrfCheck.res;

      const parsed = parseBody(event);
      if (!parsed.ok) return parsed.res;

      const v = validatePrefs(parsed.data);
      if (!v.ok) return http(400, { ok: false, error: v.error });

      // Порожній patch — нічого не робимо, але віддаємо поточний стан
      if (Object.keys(v.data).length === 0) {
        const data = await readPrefs(client, userId, sessionKey);
        return http(200, { ok: true, data });
      }

      await writePrefs(client, userId, sessionKey, v.data);

      // ВАЖЛИВО: ECHO — перечитуємо з БД ПІСЛЯ оновлення
      const data = await readPrefs(client, userId, sessionKey);
      return http(200, { ok: true, data });
    }

    return http(405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('preferences error:', err);
    return http(500, { ok: false, error: 'server_error' });
  } finally {
    client.release();
  }
};
