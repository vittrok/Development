// File: functions/me.js
// GET /me
// Архітектура v1.1:
// - Перевірка cookie-сесії (sid.sig) з підписом через SESSION_SECRET
// - csrf = HMAC(CSRF_SECRET, sid)
// - Повертаємо мінімальний профіль + preferences з user_preferences (jsonb data)
// - Back-compat: якщо в data немає sort_col/sort_order, але є data.sort ("date_desc"),
//   розкладаємо його на два поля (sort_col="date", sort_order="desc")

const { Pool } = require("pg");
const crypto = require("crypto");

const {
  APP_ORIGIN,
  DATABASE_URL,
  SESSION_SECRET,
  CSRF_SECRET,
} = process.env;

const ORIGIN = APP_ORIGIN || "https://football-m.netlify.app";

function _cors() {
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-CSRF, Cookie",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json; charset=utf-8",
  };
}
function json(status, obj) {
  return { statusCode: status, headers: _cors(), body: JSON.stringify(obj) };
}
function normStr(v) {
  return typeof v === "string" ? v.trim() : "";
}
function timingSafeEq(a, b) {
  const aa = Buffer.from(String(a) || "");
  const bb = Buffer.from(String(b) || "");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}
function hmacHex(secret, data) {
  return crypto.createHmac("sha256", String(secret)).update(String(data)).digest("hex");
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

let _pool = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }  // Neon/Supabase
    });
  }
  return _pool;
}

function getSessionCookie(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || "";
  const cookies = parseCookies(raw);
  return cookies["session"] || "";
}
function parseSidSig(cookieVal) {
  if (!cookieVal) return null;
  const dot = cookieVal.lastIndexOf(".");
  if (dot <= 0) return null;
  const sid = cookieVal.slice(0, dot);
  const sig = cookieVal.slice(dot + 1);
  return { sid, sig };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: _cors(), body: "" };
    }
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    const cookieVal = getSessionCookie(event);
    const parsed = parseSidSig(cookieVal) || {};
    const sid = normStr(parsed.sid);
    const sig = normStr(parsed.sig);

    // Анонім: ok:true, auth:false, csrf:null, preferences:{}
    let resp = {
      ok: true,
      auth: { isAuthenticated: false },
      csrf: null,
      preferences: {},
    };
    if (!sid || !sig || !SESSION_SECRET) {
      return json(200, resp);
    }

    // Перевірка підпису sid.sig
    const goodSig = hmacHex(SESSION_SECRET, sid);
    if (!timingSafeEq(goodSig, sig)) {
      return json(200, resp);
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      // 1) Валідація активної сесії та роль
      const r = await client.query(
        `
        SELECT s.user_id, s.expires_at, s.revoked, u.role
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.sid = $1
        `,
        [sid]
      );
      if (!r.rowCount) return json(200, resp);

      const row = r.rows[0];
      if (row.revoked) return json(200, resp);
      if (!row.expires_at || new Date(row.expires_at) <= new Date()) return json(200, resp);

      // 2) CSRF = HMAC(CSRF_SECRET, sid)
      const csrf = CSRF_SECRET ? hmacHex(CSRF_SECRET, sid) : null;

      // 3) Preferences з user_preferences (jsonb data)
      let seen_color = null;
      let sort_col = null;
      let sort_order = null;

      try {
        const pr = await client.query(
          `
          SELECT data
          FROM user_preferences
          WHERE user_id = $1
          LIMIT 1
          `,
          [row.user_id]
        );
        if (pr.rowCount) {
          const data = pr.rows[0]?.data || {};
          if (typeof data.seen_color === "string") seen_color = data.seen_color;

          // Якщо є окремі sort_col/sort_order — беремо їх
          if (typeof data.sort_col === "string") sort_col = data.sort_col;
          if (typeof data.sort_order === "string") sort_order = data.sort_order;

          // Back-compat: якщо є лише "sort":"date_desc" — розкладаємо
          if ((!sort_col || !sort_order) && typeof data.sort === "string") {
            const m = data.sort.match(/^([a-z0-9]+)_(asc|desc)$/i);
            if (m) {
              sort_col = sort_col || m[1].toLowerCase();
              sort_order = sort_order || m[2].toLowerCase();
            }
          }
        }
      } catch (prefErr) {
        console.error("[/me] user_preferences read failed:", prefErr);
        // Не валимо весь /me; повертаємо дефолтні префи
      }

      resp = {
        ok: true,
        auth: {
          isAuthenticated: true,
          role: row.role || null,
          sid_prefix: sid.slice(0, 8),
        },
        csrf,
        preferences: { seen_color, sort_col, sort_order },
      };
      return json(200, resp);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[/me] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
