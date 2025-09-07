// GET /me
// Архітектура v1.1: перевіряє cookie-сесію admin і повертає csrf = HMAC(CSRF_SECRET, sid)

const { Pool } = require("pg");
const crypto = require("crypto");

const ORIGIN = "https://football-m.netlify.app"; // прод-оригін
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-CSRF",
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
  // розбиваємо саме по "; " — краща точність для Cookie
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

const connectionString =
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const CSRF_SECRET = process.env.CSRF_SECRET || "";

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

    const cookieVal = getSessionCookie(event);
    const parsed = parseSidSig(cookieVal) || {};
    const sid = normStr(parsed.sid);
    const sig = normStr(parsed.sig);

    let resp = {
      ok: true,
      auth: { isAuthenticated: false, role: null, sid_prefix: null },
      csrf: null,
    };

    if (!sid || !sig || !SESSION_SECRET) {
      return json(200, resp);
    }

    // Перевірка підпису cookie
    const expectedSig = hmacHex(SESSION_SECRET, sid);
    if (!timingSafeEq(sig, expectedSig)) {
      return json(200, resp);
    }

    // Lookup у БД сесії + ролі
    const client = await pool.connect();
    try {
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
        return json(200, resp);
      }

      const row = r.rows[0];
      if (row.revoked) {
        return json(200, resp);
      }
      if (!row.expires_at || new Date(row.expires_at) <= new Date()) {
        return json(200, resp);
      }

      const role = row.role || null;
      // За архітектурою нам потрібен admin для адмін-дій, але /me просто відображає стан
      const csrf = CSRF_SECRET ? hmacHex(CSRF_SECRET, sid) : null;

      resp = {
        ok: true,
        auth: {
          isAuthenticated: true,
          role,
          sid_prefix: sid.slice(0, 8),
        },
        csrf,
      };
      return json(200, resp);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[me] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
