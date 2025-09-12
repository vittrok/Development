// File: functions/preferences.js
// Архітектура v1.1 — єдине джерело користувацьких преференсів.
//
// Поведінка:
// - OPTIONS → 204 + CORS
// - GET     → 200 { ok:true, data:{ seen_color, sort_col, sort_order } }  (пер-юзер)
// - POST    → 200 { ok:true }  (upsert пер-юзер), з перевіркою X-CSRF та сесії
//
// Без хардкоду логін/пароль (правило 13). Працюємо з таблицею `preferences`, прив'язуємо рядок до user_id.
//
// Валідні значення:
//   sort_col   ∈ ['rank','match','tournament','date','link','seen','comments','kickoff_at','home_team','away_team','status']
//   sort_order ∈ ['asc','desc']
//   seen_color — CSS-колір (перевіряємо простим regex на #hex/rgb[a]/hsl[a] або назву; якщо не пройшло — 400)

const { getClient } = require('./_db');
const { corsHeaders } = require('./_utils');
const { getSession } = require('./_session');

const ALLOWED_COLS = ['rank','match','tournament','date','link','seen','comments','kickoff_at','home_team','away_team','status'];
const ALLOWED_ORDS = ['asc','desc'];

function isValidColor(v) {
  if (!v || typeof v !== 'string') return false;
  const s = v.trim();
  // Дуже прості перевірки (достатньо для UI-преференсу)
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
  if (/^rgb(a)?\(/i.test(s)) return true;
  if (/^hsl(a)?\(/i.test(s)) return true;
  if (/^[a-z]+$/i.test(s)) return true; // назви кольорів
  return false;
}

function json(status, body) {
  return { statusCode: status, headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const client = getClient();

  // Дістаємо сесію (може бути відсутня — тоді GET поверне дефолт/порожні дані; POST вимагатиме сесію)
  let session = null;
  try {
    session = await getSession(event);
  } catch (e) {
    // Якщо getSession кине — для GET не фейлимо, для POST перевіримо нижче
    session = null;
  }

  if (event.httpMethod === 'GET') {
    try {
      await client.connect();
      let data = { };

      if (session && session.user_id) {
        const r = await client.query(
          `SELECT seen_color, sort_col, sort_order
           FROM preferences
           WHERE user_id = $1
           ORDER BY updated_at DESC
           LIMIT 1`,
          [session.user_id]
        );
        if (r.rowCount) {
          const row = r.rows[0] || {};
          data = {
            ...(row.seen_color ? { seen_color: row.seen_color } : {}),
            ...(row.sort_col ? { sort_col: row.sort_col } : {}),
            ...(row.sort_order ? { sort_order: row.sort_order } : {}),
          };
        }
      }

      // Back-compat: якщо на фронті ще шукають "data.sort" — не повертаємо, бо ми вже віддали розкладені поля
      return json(200, { ok: true, data });
    } catch (e) {
      return json(500, { ok: false, error: 'internal_error', detail: String(e && e.message || e) });
    } finally {
      try { await client.end(); } catch {}
    }
  }

  if (event.httpMethod === 'POST') {
    // Потрібні: сесія і валідний X-CSRF
    if (!session || !session.user_id) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    const csrf = event.headers['x-csrf'] || event.headers['X-CSRF'];
    if (!csrf || csrf !== session.csrf) {
      return json(403, { ok: false, error: 'csrf_required_or_invalid' });
    }

    // Парсимо body
    let payload = {};
    try {
      if (!event.body) payload = {};
      else if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
        payload = JSON.parse(event.body);
      } else if (event.headers['content-type'] && event.headers['content-type'].includes('application/x-www-form-urlencoded')) {
        payload = {};
        for (const kv of String(event.body).split('&')) {
          const [k, v=''] = kv.split('=');
          payload[decodeURIComponent(k.replace(/\+/g,' '))] = decodeURIComponent(v.replace(/\+/g,' '));
        }
      } else {
        // Спробуємо як JSON за замовчуванням
        payload = JSON.parse(event.body);
      }
    } catch {
      return json(400, { ok: false, error: 'invalid_json' });
    }

    // Валідатори
    const toUpdate = {};
    if (payload.seen_color != null) {
      if (!isValidColor(payload.seen_color)) return json(400, { ok:false, error:'invalid_seen_color' });
      toUpdate.seen_color = String(payload.seen_color).trim();
    }
    if (payload.sort_col != null) {
      const col = String(payload.sort_col).trim();
      if (!ALLOWED_COLS.includes(col)) return json(400, { ok:false, error:'invalid_sort_col' });
      toUpdate.sort_col = col;
    }
    if (payload.sort_order != null) {
      const ord = String(payload.sort_order).trim().toLowerCase();
      if (!ALLOWED_ORDS.includes(ord)) return json(400, { ok:false, error:'invalid_sort_order' });
      toUpdate.sort_order = ord;
    }

    if (!Object.keys(toUpdate).length) {
      return json(400, { ok:false, error:'nothing_to_update' });
    }

    try {
      await client.connect();

      // Чи є існуючий запис?
      const cur = await client.query(
        `SELECT id FROM preferences WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [session.user_id]
      );

      if (cur.rowCount) {
        // UPDATE останнього запису користувача
        const id = cur.rows[0].id;
        const fields = [];
        const vals   = [];
        let idx = 1;
        for (const [k, v] of Object.entries(toUpdate)) {
          fields.push(`${k} = $${++idx}`);
          vals.push(v);
        }
        // updated_at/updated_by
        fields.push(`updated_at = now()`);
        fields.push(`updated_by = $${++idx}`);
        vals.push(session.user_id);

        await client.query(
          `UPDATE preferences
             SET ${fields.join(', ')}
           WHERE id = $1`,
          [id, ...vals]
        );
      } else {
        // INSERT нових преференсів для user_id
        const cols = ['user_id'];
        const qms  = ['$1'];
        const vals = [session.user_id];
        let i = 1;

        for (const [k, v] of Object.entries(toUpdate)) {
          cols.push(k);
          qms.push(`$${++i}`);
          vals.push(v);
        }
        cols.push('updated_by');
        qms.push(`$${++i}`);
        vals.push(session.user_id);

        await client.query(
          `INSERT INTO preferences (${cols.join(', ')})
           VALUES (${qms.join(', ')})`
          , vals
        );
      }

      return json(200, { ok:true });
    } catch (e) {
      return json(500, { ok:false, error:'internal_error', detail: String(e && e.message || e) });
    } finally {
      try { await client.end(); } catch {}
    }
  }

  return json(405, { ok:false, error:'method_not_allowed' });
};
