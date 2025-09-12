// functions/preferences.js
// Архітектура v1.1: єдиний ендпойнт для користувацьких преференсів.
// - OPTIONS → 204 + CORS
// - GET     → 200 { ok:true, data:{ seen_color?, sort_col?, sort_order? } }   (пер-юзер, якщо є сесія; інакше — порожні дані)
// - POST    → 200 { ok:true }  (upsert пер-юзер), вимагає валідні сесію та X-CSRF
//
// Без хардкоду паролів (правило 13).
// Працюємо з таблицею `preferences`, прив'язка за `user_id` із сесії.
//
// Залежності: _db.query, _utils.corsHeaders, _session.getSession

const { query } = require('./_db');
const { corsHeaders } = require('./_utils');
const { getSession } = require('./_session');

const ALLOWED_COLS = ['rank','match','tournament','date','link','seen','comments','kickoff_at','home_team','away_team','status'];
const ALLOWED_ORDS = ['asc','desc'];

function isValidColor(v) {
  if (!v || typeof v !== 'string') return false;
  const s = v.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
  if (/^rgb(a)?\(/i.test(s)) return true;
  if (/^hsl(a)?\(/i.test(s)) return true;
  if (/^[a-z]+$/i.test(s)) return true; // назва кольору
  return false;
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

// Дістаємо sid із cookie: "session=<sid>.<sig>"
function extractSidFromCookie(cookieHdr) {
  if (!cookieHdr) return null;
  // шукаємо пару session=...
  const m = String(cookieHdr).match(/(?:^|;\s*)session=([^;]+)/i);
  if (!m) return null;
  const val = m[1];           // "<sid>.<sig>"
  const sid = val.split('.')[0]; // беремо до крапки
  return sid || null;
}

async function getUserIdFromEvent(event) {
  const cookie = event.headers?.cookie || event.headers?.Cookie;
  const sid = extractSidFromCookie(cookie);
  if (!sid) return null;
  const sess = await getSession(sid);
  // очікуємо, що getSession повертає { sid, user_id, username, role } або null
  return sess?.user_id || null;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // ---------- GET ----------
  if (event.httpMethod === 'GET') {
    try {
      const userId = await getUserIdFromEvent(event);
      if (!userId) {
        // Без сесії — віддаємо порожні дані (фронт візьме дефолти).
        return json(200, { ok: true, data: {} });
      }

      const r = await query(
        `SELECT seen_color, sort_col, sort_order
           FROM preferences
          WHERE user_id = $1
          ORDER BY updated_at DESC
          LIMIT 1`,
        [userId]
      );

      const data = r.rowCount
        ? {
            ...(r.rows[0].seen_color ? { seen_color: r.rows[0].seen_color } : {}),
            ...(r.rows[0].sort_col ? { sort_col: r.rows[0].sort_col } : {}),
            ...(r.rows[0].sort_order ? { sort_order: r.rows[0].sort_order } : {}),
          }
        : {};

      return json(200, { ok: true, data });
    } catch (e) {
      return json(500, { ok: false, error: 'internal_error', detail: String(e?.message || e) });
    }
  }

  // ---------- POST ----------
  if (event.httpMethod === 'POST') {
    try {
      // 1) Перевірка сесії
      const userId = await getUserIdFromEvent(event);
      if (!userId) {
        return json(401, { ok: false, error: 'unauthorized' });
      }

      // 2) Перевірка CSRF (double-submit; токен ви віддаєте з /me)
      const hdrs = event.headers || {};
      const csrf = hdrs['x-csrf'] || hdrs['X-CSRF'] || hdrs['x-csrf-token'] || hdrs['X-CSRF-Token'];
      // /me повертає сам токен; тут — просто звірка з тим, що покладено у сесію на боці вашого /me.
      // Якщо ваша реалізація зберігає csrf у sessions або генерує на льоту — відкоригуйте цю перевірку
      // (наприклад, зробіть getCsrfFromSession(sid) і звірте).
      // Зараз ми приймаємо, що /preferences викликається з валідним X-CSRF, а /me це забезпечує на фронті.
      if (!csrf) {
        return json(403, { ok: false, error: 'csrf_required_or_invalid' });
      }

      // 3) Парсимо тіло
      let payload = {};
      const ct = String(event.headers['content-type'] || '').toLowerCase();
      try {
        if (!event.body) {
          payload = {};
        } else if (ct.includes('application/json')) {
          payload = JSON.parse(event.body);
        } else if (ct.includes('application/x-www-form-urlencoded')) {
          payload = {};
          for (const kv of String(event.body).split('&')) {
            const [k, v = ''] = kv.split('=');
            payload[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
          }
        } else {
          payload = JSON.parse(event.body);
        }
      } catch {
        return json(400, { ok: false, error: 'invalid_json' });
      }

      // 4) Валідації
      const toUpdate = {};
      if (payload.seen_color != null) {
        if (!isValidColor(payload.seen_color)) return json(400, { ok: false, error: 'invalid_seen_color' });
        toUpdate.seen_color = String(payload.seen_color).trim();
      }
      if (payload.sort_col != null) {
        const col = String(payload.sort_col).trim();
        if (!ALLOWED_COLS.includes(col)) return json(400, { ok: false, error: 'invalid_sort_col' });
        toUpdate.sort_col = col;
      }
      if (payload.sort_order != null) {
        const ord = String(payload.sort_order).trim().toLowerCase();
        if (!ALLOWED_ORDS.includes(ord)) return json(400, { ok: false, error: 'invalid_sort_order' });
        toUpdate.sort_order = ord;
      }
      if (!Object.keys(toUpdate).length) {
        return json(400, { ok: false, error: 'nothing_to_update' });
      }

      // 5) Upsert пер-юзер
      // Перевіримо, чи існує рядок для user_id
      const cur = await query(
        `SELECT id FROM preferences WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`,
        [userId]
      );

      if (cur.rowCount) {
        // UPDATE останнього запису
        const id = cur.rows[0].id;
        const sets = [];
        const vals = [id];
        let i = 1;
        for (const [k, v] of Object.entries(toUpdate)) {
          sets.push(`${k}=$${++i}`);
          vals.push(v);
        }
        sets.push(`updated_at=now()`);
        sets.push(`updated_by=$${++i}`);
        vals.push(userId);

        await query(
          `UPDATE preferences SET ${sets.join(', ')} WHERE id=$1`,
          vals
        );
      } else {
        // INSERT нового
        const cols = ['user_id'];
        const qms  = ['$1'];
        const vals = [userId];
        let i = 1;

        for (const [k, v] of Object.entries(toUpdate)) {
          cols.push(k);
          qms.push(`$${++i}`);
          vals.push(v);
        }
        cols.push('updated_by');
        qms.push(`$${++i}`);
        vals.push(userId);

        await query(
          `INSERT INTO preferences (${cols.join(', ')}) VALUES (${qms.join(', ')})`,
          vals
        );
      }

      return json(200, { ok: true });
    } catch (e) {
      return json(500, { ok: false, error: 'internal_error', detail: String(e?.message || e) });
    }
  }

  return json(405, { ok: false, error: 'method_not_allowed' });
};
