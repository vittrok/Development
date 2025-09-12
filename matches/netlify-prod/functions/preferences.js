// File: functions/preferences.js
// GET  /preferences  -> повертає data (jsonb) для поточного користувача (анонімам — дефолти)
// POST /preferences  -> мерджить payload у user_preferences.data (jsonb)
// Захист (арх. v1.1): session cookie + CSRF (HMAC(CSRF_SECRET, sid)) + Origin whitelist (для POST)

const { Pool } = require("pg");
const crypto = require("crypto");
const querystring = require("querystring");

const {
  APP_ORIGIN,
  DATABASE_URL,
  SESSION_SECRET,
  CSRF_SECRET,
} = process.env;

// ---------- PG Pool (синглтон) ----------
let _pool;
function pool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

// ---------- Допоміжні утиліти ----------
function corsHeaders() {
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": APP_ORIGIN || "https://football-m.netlify.app",
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
function text(status, msg) {
  const h = corsHeaders();
  h["Content-Type"] = "text/plain; charset=utf-8";
  return { statusCode: status, headers: h, body: msg };
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
  for (const part of String(header || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
function parseSidSig(cookieVal) {
  if (!cookieVal) return null;
  const dot = cookieVal.lastIndexOf(".");
  if (dot <= 0) return null;
  return { sid: cookieVal.slice(0, dot), sig: cookieVal.slice(dot + 1) };
}
function isAllowedOrigin(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const need = APP_ORIGIN || "https://football-m.netlify.app";
  return origin === need;
}

// Надійний парсер тіла (JSON або x-www-form-urlencoded)
function parseBody(event) {
  const ct = String(event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();
  let raw = event.body || "";
  if (!raw) return {};

  // Netlify може інколи надсилати base64: тут цього не спостерігали, але на всяк випадок
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }

  if (ct.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Invalid JSON body");
    }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    return querystring.parse(raw);
  }
  // інші типи не підтримуємо
  return {};
}

// Витяг user_id із сесії через таблицю sessions (перевіряємо підпис sid.sig і строк дії)
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
        WHERE s.sid = $1
        LIMIT 1`,
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

// ---------- handler ----------
exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    // GET: дозволяємо анонімний рідер (повертаємо дефолти)
    if (event.httpMethod === "GET") {
      const u = await getUserFromSession(event);
      const cli = await pool().connect();
      try {
        if (!u) {
          // анонім: повертаємо дефолт/публічні фільтри — без персональних даних
          return json(200, { ok: true, data: { sort: "date_desc", filters: { league: "EPL" } } });
        }

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

    // POST: тільки для авторизованих + CSRF + Origin
    if (event.httpMethod === "POST") {
      if (!isAllowedOrigin(event)) {
        return text(403, "forbidden origin");
      }

      const u = await getUserFromSession(event);
      if (!u) return text(401, "unauthorized");

      // CSRF: X-CSRF == HMAC(CSRF_SECRET, sid)
      const hdr = event.headers || {};
      const xcsrf = hdr["x-csrf"] || hdr["X-CSRF"] || hdr["x-Csrf"];
      const expect = hmacHex(CSRF_SECRET || "dev-csrf", u.sid);
      if (!xcsrf || !timingSafeEq(String(xcsrf), String(expect))) {
        return text(401, "csrf invalid");
      }

      // Тіло
      let patch;
      try {
        patch = parseBody(event);
      } catch (e) {
        return json(400, { ok: false, error: e.message || "Invalid body" });
      }
      if (!patch || typeof patch !== "object") patch = {};

      // Вайтліст верхнього рівня
      const allowedTop = ["sort", "sort_col", "sort_order", "seen_color", "filters"];
      const sanitized = {};
      for (const k of Object.keys(patch)) {
        if (allowedTop.includes(k)) sanitized[k] = patch[k];
      }

      const cli = await pool().connect();
      try {
        // Поточні значення
        const r = await cli.query(
          `SELECT data FROM user_preferences WHERE user_id = $1 LIMIT 1`,
          [u.user_id]
        );
        const current = r.rowCount ? r.rows[0].data || {} : {};

        // Глибокий мердж (для простих об'єктів)
        const merged = deepMerge({ ...current }, sanitized);

        // UPSERT
        await cli.query(
          `INSERT INTO user_preferences (user_id, data, created_at, updated_at)
               VALUES ($1, $2::jsonb, NOW(), NOW())
          ON CONFLICT (user_id)
          DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [u.user_id, merged]
        );

        return json(200, { ok: true, data: merged });
      } finally {
        cli.release();
      }
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    console.error("[/preferences] fatal:", e);
    return text(500, "internal");
  }
};

// Глибокий мердж для простих об'єктів
function deepMerge(target, src) {
  if (src && typeof src === "object" && !Array.isArray(src)) {
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        target[k] = deepMerge(target[k] ?? {}, v);
      } else {
        target[k] = v;
      }
    }
    return target;
  }
  return src;
}
