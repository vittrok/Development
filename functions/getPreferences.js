// GET /getPreferences
// Архітектура v1.1:
// - Перевірка cookie-сесії (sid.sig) з підписом через SESSION_SECRET
// - Повертаємо лише preferences (seen_color, sort_col, sort_order)
// - CORS сумісний з /me; жодних зовнішніх хелперів типу isAllowedOrigin

const { Pool } = require("pg");
const crypto = require("crypto");

const ORIGIN = "https://football-m.netlify.app"; // прод-оригін
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-CSRF, Cookie",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

function json(status, obj) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify(obj) };
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
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

const connectionString =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.PG_CONNECTION_STRING ||
  "";

const SESSION_SECRET = process.env.SESSION_SECRET || "";

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

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
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    // Перевірка Origin (жорстка відповідно до архітектури)
    const origin = event.headers?.origin || event.headers?.Origin;
    if (origin && origin !== ORIGIN) {
      return json(403, { ok: false, error: "forbidden_origin" });
    }

    const cookieVal = getSessionCookie(event);
    const parsed = parseSidSig(cookieVal) || {};
    const sid = normStr(parsed.sid);
    const sig = normStr(parsed.sig);

    // Базова відповідь: лише preferences-ключ з дефолтами
    let resp = {
      ok: true,
      preferences: { seen_color: null, sort_col: null, sort_order: null },
    };

    // Якщо немає cookie/секретів — повертаємо дефолти (гостьовий режим)
    if (!sid || !sig || !SESSION_SECRET) {
      return json(200, resp);
    }

    // Перевірка підпису cookie: sig == HMAC(SESSION_SECRET, sid)
    const expectedSig = hmacHex(SESSION_SECRET, sid);
    if (!timingSafeEq(sig, expectedSig)) {
      return json(200, resp);
    }

    const client = await pool.connect();
    try {
      // Перевіряємо валідність сесії та дістаємо user_id
      const r = await client.query(
        `
        SELECT s.user_id, s.expires_at, s.revoked
        FROM sessions s
        WHERE s.sid = $1
        `,
        [sid]
      );
      if (!r.rowCount) return json(200, resp);

      const row = r.rows[0];
      if (row.revoked) return json(200, resp);
      if (!row.expires_at || new Date(row.expires_at) <= new Date()) return json(200, resp);

      // Тягнемо preferences за вашою реальною схемою (sort_col, sort_order, seen_color)
      const pr = await client.query(
        `
        SELECT seen_color, sort_col, sort_order
        FROM preferences
        WHERE user_id = $1
        LIMIT 1
        `,
        [row.user_id]
      );

      if (pr.rowCount) {
        const p = pr.rows[0] || {};
        resp.preferences = {
          seen_color: p.seen_color || null,
          sort_col:   p.sort_col   || null,
          sort_order: p.sort_order || null,
        };
      }
      return json(200, resp);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[getPreferences] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
