// File: functions/preferences.js
// GET  /preferences  -> повертає data (jsonb) для поточного користувача
// POST /preferences  -> мерджить payload у user_preferences.data (jsonb)
// Захист (арх. v1.1): session cookie + CSRF + Origin whitelist (для POST)

const { Pool } = require("pg");
const crypto = require("crypto");
const querystring = require("querystring");

const {
  APP_ORIGIN,
  DATABASE_URL,
  SESSION_SECRET,
  CSRF_SECRET,
} = process.env;

const ORIGIN = APP_ORIGIN || "https://football-m.netlify.app";

function corsHeaders() {
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
  return { statusCode: status, headers: corsHeaders(), body: JSON.stringify(obj) };
}
function text(status, body) {
  return { statusCode: status, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" }, body };
}
function normStr(v) {
  return typeof v === "string" ? v.trim() : "";
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
function parseSidSig(cookieVal) {
  if (!cookieVal) return null;
  const dot = cookieVal.lastIndexOf(".");
  if (dot <= 0) return null;
  const sid = cookieVal.slice(0, dot);
  const sig = cookieVal.slice(dot + 1);
  return { sid, sig };
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

let _pool = null;
function pool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

function getOrigin(event) {
  return event.headers["origin"] || event.headers["Origin"] || "";
}
function isAllowedOrigin(origin) {
  // єдиний дозволений origin з архітектури
  return normStr(origin) === ORIGIN;
}

async function getUserFromSession(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || "";
  const cookies = parseCookies(raw);
  const session = cookies["session"] || "";
  const parsed = parseSidSig(session) || {};
  const sid = normStr(parsed.sid);
  const sig = normStr(parsed.sig);

  if (!sid || !sig || !SESSION_SECRET) return null;
  const goodSig = hmacHex(SESSION_SECRET, sid);
  if (!timingSafeEq(goodSig, sig)) return null;

  const cli = await pool().connect();
  try {
    const r = await cli.query(
      `SELECT s.user_id, s.expires_at, s.revoked
         FROM sessions s
        WHERE s.sid = $1`,
      [sid]
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    if (row.revoked) return null;
    if (!row.expires_at || new Date(row.expires_at) <= new Date()) return null;
    return { user_id: row.user_id, sid };
  } finally {
    cli.release();
  }
}

function parseBody(event) {
  const ct = String(event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();
  const raw = event.body || "";
  if (!raw) return {};

  if (ct.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      // нехай клієнт бачить зрозумілу помилку
      throw new Error("Invalid JSON body");
    }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    return querystring.parse(raw);
  }
  // інше ігноруємо
  return {};
}

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    // GET: дозволяємо анонімний рідер (повертаємо дефолт)
    if (event.httpMethod === "GET") {
      const u = await getUserFromSession(event);
      if (!u) {
        // анонім: повертаємо дефолт/публічні фільтри — без персональних даних
        return json(200, { ok: true, data: { sort: "date_desc", filters: { league: "EPL" } } });
      }

      const cli = await pool().connect();
      try {
        const r = await cli.query(
          `SELECT data FROM user_preferences WHERE user_id = $1 LIMIT 1`,
          [u.user_id]
        );
        const data = r.rowCount ? r.rows[0].data || {} : {};
        // Мінімальний дефолт, якщо порожньо
        const merged = { sort: "date_desc", filters: { league: "EPL" }, ...data };
        return json(200, { ok: true, data: merged });
      } finally {
        cli.release();
      }
    }

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    // POST: 1) Origin whitelist
    const origin = getOrigin(event);
    if (!isAllowedOrigin(origin)) {
      // важливо: повертаємо 200? Ні — краще 403, щоб тести відловлювали
      return text(403, "forbidden origin");
    }

    // 2) Сесія обов’язкова
    const u = await getUserFromSession(event);
    if (!u) {
      return text(401, "unauthorized");
    }

    // 3) CSRF = HMAC(CSRF_SECRET, sid) — обов’язковий
    const csrfHeader = normStr(event.headers["x-csrf"] || event.headers["X-CSRF"] || "");
    if (!csrfHeader || !CSRF_SECRET) {
      return text(401, "csrf required");
    }
    const goodCsrf = hmacHex(CSRF_SECRET, u.sid);
    if (!timingSafeEq(goodCsrf, csrfHeader)) {
      return text(401, "csrf invalid");
    }

    // 4) Body
    let payload = {};
    try {
      payload = parseBody(event);
    } catch (e) {
      return text(400, e.message || "bad request");
    }

    // Простий whitelist: дозволяємо тільки кілька ключів (можна розширити у майбутньому)
    const allowed = ["seen_color", "sort", "sort_col", "sort_order", "filters"];
    const clean = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) {
        clean[k] = payload[k];
      }
    }

    // 5) Merge у jsonb
    const cli = await pool().connect();
    try {
      await cli.query(
        `
        INSERT INTO user_preferences (user_id, data)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (user_id) DO UPDATE
          SET data = user_preferences.data || EXCLUDED.data,
              updated_at = now()
        `,
        [u.user_id, JSON.stringify(clean)]
      );

      const r2 = await cli.query(
        `SELECT data FROM user_preferences WHERE user_id = $1 LIMIT 1`,
        [u.user_id]
      );
      const data = r2.rowCount ? r2.rows[0].data || {} : {};
      // додамо мінімальні дефолти зверху
      const merged = { sort: "date_desc", filters: { league: "EPL" }, ...data };
      return json(200, { ok: true, data: merged });
    } finally {
      cli.release();
    }
  } catch (e) {
    console.error("[/preferences] fatal:", e);
    return text(500, "internal");
  }
};
