// functions/preferences.js
//
// Єдиний ендпоїнт /preferences з локальними перевірками Origin/CSRF.
// Приймає application/json (з charset, base64) та application/x-www-form-urlencoded.
// Використовує ваш getSession(event) з ./_session.
// Мерджить дані у user_preferences.data (jsonb).

const { getSession } = require('./_session');
const { getDb } = require('./_db');

const APP_ORIGIN = process.env.APP_ORIGIN;

// Дозволені ключі у user_preferences.data (верхній рівень)
const ALLOWED_KEYS = new Set(['sort', 'sort_col', 'sort_order', 'seen_color', 'filters']);

// ---------- УТИЛІТИ ----------
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

function requireOriginLocal(event) {
  const hdr = event.headers || {};
  const origin = hdr.origin || hdr.Origin || '';
  if (!APP_ORIGIN || origin === APP_ORIGIN) {
    return { ok: true, origin: APP_ORIGIN || origin || '*' };
  }
  return { ok: false, origin: APP_ORIGIN, reason: 'forbidden origin' };
}

function requireCsrfLocal(event, sess) {
  const hdr = event.headers || {};
  const x = hdr['x-csrf'] || hdr['X-CSRF'] || hdr['x-Csrf'];
  if (!x || !sess?.csrf || String(x) !== String(sess.csrf)) {
    return { ok: false, reason: 'csrf invalid' };
  }
  return { ok: true };
}

function parseJsonBody(event) {
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
  const isJson = ct.startsWith('application/json');
  if (!isJson) return null;

  let raw = event.body;
  if (event.isBase64Encoded) {
    try { raw = Buffer.from(raw || '', 'base64').toString('utf8'); }
    catch { throw new Error('invalid_base64_body'); }
  }
  if (typeof raw !== 'string') throw new Error('invalid_json_body_type');

  try { return JSON.parse(raw); }
  catch { throw new Error('invalid_json_body'); }
}

function parseFormBody(event) {
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
  const isForm = ct.startsWith('application/x-www-form-urlencoded');
  if (!isForm) return null;

  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');

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

// Адаптивний витяг userId зі сесії
function extractUserId(sess) {
  if (!sess || typeof sess !== 'object') return null;
  return (
    sess.userId ??
    sess.user_id ??
    (sess.user && (sess.user.id ?? sess.user.user_id)) ??
    sess.uid ??
    sess.sub ??
    sess.id ??
    null
  );
}

// ---------- HANDLER ----------
exports.handler = async (event /*, context */) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': APP_ORIGIN || '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-CSRF, Cookie',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      },
      body: '',
    };
  }

  // Origin
  const o = requireOriginLocal(event);
  if (!o.ok) return errText(403, 'forbidden origin', o.origin);

  // Session
  const sess = await getSession(event);
  const userId = extractUserId(sess);
  if (!userId) return errText(401, 'unauthorized', o.origin);

  if (event.httpMethod === 'GET') {
    const db = await getDb();
    const row = await db.oneOrNone(`select data from user_preferences where user_id = $1`, [userId]);
    const data = row?.data || {};
    return okJson({ ok: true, data }, o.origin);
  }

  if (event.httpMethod === 'POST') {
    // CSRF
    const c = requireCsrfLocal(event, sess);
    if (!c.ok) return errText(401, 'csrf invalid', o.origin);

    // Body: JSON або FORM
    let patch = null;
    try {
      patch = parseJsonBody(event);
    } catch (e) {
      if (e.message === 'invalid_base64_body' || e.message === 'invalid_json_body' || e.message === 'invalid_json_body_type') {
        return errText(400, 'Invalid JSON body', o.origin);
      }
      return errText(400, 'Bad Request', o.origin);
    }
    if (patch == null) {
      patch = parseFormBody(event);
      if (patch == null) return errText(415, 'Unsupported Media Type', o.origin);
    }

    // Вайтліст верхнього рівня
    const sanitized = {};
    for (const k of Object.keys(patch)) {
      if (ALLOWED_KEYS.has(k)) sanitized[k] = patch[k];
    }

    const db = await getDb();

    // Поточні значення
    const row = await db.oneOrNone(`select data from user_preferences where user_id = $1`, [userId]);
    const current = row?.data || {};

    // Мердж
    const merged = deepMerge({ ...current }, sanitized);

    // UPSERT
    await db.none(
      `insert into user_preferences (user_id, data, created_at, updated_at)
       values ($1, $2::jsonb, now(), now())
       on conflict (user_id) do update
       set data = EXCLUDED.data, updated_at = now()`,
      [userId, merged]
    );

    return okJson({ ok: true, data: merged }, o.origin);
  }

  return errText(405, 'method not allowed', o.origin);
};
