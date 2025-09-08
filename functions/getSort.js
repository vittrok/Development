// GET /.netlify/functions/getSort
// Архітектура v1.1: cookie-сесія (admin), м'які rate limits, без CSRF (тільки для POST/мутацій)

const { Pool } = require("pg");
const crypto = require("crypto");

// ==== CORS/Headers ===========================================================
const ORIGIN = "https://football-m.netlify.app";
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cookie, X-Requested-With",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function json(status, obj, extraHeaders = {}) {
  return { statusCode: status, headers: { ...corsHeaders, ...extraHeaders }, body: JSON.stringify(obj) };
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

// ==== ENV/DB =================================================================
const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

// ==== Main Handler ===========================================================
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    // --- Session cookie + signature ---
    const cookieVal = getSessionCookie(event);
    const parsed = parseSidSig(cookieVal) || {};
    const sid = parsed.sid || "";
    const sig = parsed.sig || "";

    if (!sid || !sig || !SESSION_SECRET) {
      return json(401, { ok: false, error: "unauthorized_session", code: "missing_cookie" });
    }
    const expectedSig = hmacHex(SESSION_SECRET, sid);
    if (!timingSafeEq(sig, expectedSig)) {
      return json(401, { ok: false, error: "unauthorized_session", code: "bad_sig" });
    }

    const client = await pool.connect();
    try {
      // Перевірка сесії + ролі (як у setSort: тільки admin)
      const r = await client.query(
        `
        SELECT s.user_id, s.expires_at, s.revoked, u.role
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.sid = $1
        `,
        [sid]
      );
      if (!r.rowCount) {
        return json(401, { ok: false, error: "unauthorized_session", code: "no_session_row" });
      }
      const row = r.rows[0];
      if (row.revoked) {
        return json(401, { ok: false, error: "unauthorized_session", code: "revoked" });
      }
      if (!row.expires_at || new Date(row.expires_at) <= new Date()) {
        return json(401, { ok: false, error: "unauthorized_session", code: "expired" });
      }
      if (row.role !== "admin") {
        return json(403, { ok: false, error: "forbidden" });
      }

      const userId = row.user_id;

      // Читання преференсів
      const p = await client.query(
        `
        SELECT sort_col, sort_order
        FROM preferences
        WHERE user_id = $1
        `,
        [userId]
      );

      // Значення за замовчуванням (узгоджено з allowed у setSort)
      const col = p.rowCount ? (p.rows[0].sort_col || "kickoff_at") : "kickoff_at";
      const order = p.rowCount ? (p.rows[0].sort_order || "asc") : "asc";

      return json(200, { ok: true, sort: { col, order } });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[getSort] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
