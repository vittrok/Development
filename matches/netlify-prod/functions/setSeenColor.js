// POST /.netlify/functions/setSeenColor
// Архітектура v1.1: cookie-сесія (admin) + CSRF, м'які rate limits, валідація payload
// Підтримує application/x-www-form-urlencoded та application/json (тіло може бути base64)

const { Pool } = require("pg");
const crypto = require("crypto");

// ==== CORS/Headers ===========================================================
const ORIGIN = "https://football-m.netlify.app";
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cookie, X-Requested-With, X-CSRF",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function json(status, obj, extraHeaders = {}) {
  return { statusCode: status, headers: { ...corsHeaders, ...extraHeaders }, body: JSON.stringify(obj) };
}
function normStr(v) { return typeof v === "string" ? v.trim() : ""; }
function timingSafeEq(a, b) {
  const aa = Buffer.from(String(a) || "");
  const bb = Buffer.from(String(b) || "");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}
function hmacHex(secret, data) { return crypto.createHmac("sha256", String(secret)).update(String(data)).digest("hex"); }
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
function parseFormURLEncoded(body) {
  const out = {};
  for (const kv of String(body || "").split("&")) {
    if (!kv) continue;
    const [k, v = ""] = kv.split("=");
    const key = decodeURIComponent(k.replace(/\+/g, " "));
    const val = decodeURIComponent(v.replace(/\+/g, " "));
    out[key] = val;
  }
  return out;
}

// ==== ENV/DB =================================================================
const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const CSRF_SECRET = process.env.CSRF_SECRET || "";
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

// ==== Helpers: session/csrf ==================================================
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
function verifyCsrfToken(sid, headerVal) {
  if (!sid || !headerVal) return false;
  const expected = hmacHex(CSRF_SECRET, sid);
  return timingSafeEq(expected, headerVal);
}

// ==== Rate Limits (Fixed Window) ============================================
const RL_SESS_LIMIT = 5,   RL_SESS_WINDOW_SEC = 60;
const RL_IP_LIMIT   = 20,  RL_IP_WINDOW_SEC   = 60;
const RL_GLOB_LIMIT = 100, RL_GLOB_WINDOW_SEC = 60;

function rlSessKey(sid) { return `sess:${String(sid || "anon").slice(0,8)}:set-seen-color`; }
function rlIpKey(ip)    { return `ip:${ip || "0.0.0.0"}:set-seen-color`; }
const RL_GLOBAL_KEY = "global:set-seen-color";

async function applyRateLimit(client, key, limit, windowSec) {
  const resNow = await client.query("SELECT now() AS now");
  const now = new Date(resNow.rows[0].now);
  const resetAt = new Date(now.getTime() + windowSec * 1000);

  const upsert = await client.query(
    `
    INSERT INTO rate_limits(key, count, reset_at)
    VALUES ($1, 1, $2)
    ON CONFLICT (key)
    DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at > now() THEN rate_limits.count + 1 ELSE 1 END,
      reset_at = CASE WHEN rate_limits.reset_at > now() THEN rate_limits.reset_at ELSE $2 END
    RETURNING count, reset_at
    `,
    [key, resetAt.toISOString()]
  );
  const { count, reset_at } = upsert.rows[0];
  if (count > limit) {
    const raSec = Math.max(1, Math.ceil((new Date(reset_at).getTime() - now.getTime()) / 1000));
    return { limited: true, retryAfter: raSec };
  }
  return { limited: false };
}

function getClientIp(event) {
  const h = event.headers || {};
  const ip1 = h["x-nf-client-connection-ip"] || h["X-Nf-Client-Connection-Ip"];
  if (ip1) return String(ip1).trim();
  const xff = h["x-forwarded-for"] || h["X-Forwarded-For"];
  if (xff) return String(xff).split(",")[0].trim();
  return "0.0.0.0";
}

// ==== Validation =============================================================
const HEX6 = /^#?[0-9A-Fa-f]{6}$/;

function validateColor(input) {
  const v = normStr(input);
  if (!v) return ""; // дозволяємо порожнє — скинути
  if (!HEX6.test(v)) return null;
  return v.startsWith("#") ? v : `#${v}`;
}

// ==== Main Handler ===========================================================
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    // ---- Body parse ----
    const ctRaw = event.headers["content-type"] || event.headers["Content-Type"] || "";
    const ctype = ctRaw.split(";")[0].trim().toLowerCase();

    let raw = event.body || "";
    if (raw && event.isBase64Encoded) {
      try { raw = Buffer.from(raw, "base64").toString("utf8"); }
      catch { return json(400, { ok: false, error: "invalid_body_b64" }); }
    }

    let color = "";
    if (ctype === "application/x-www-form-urlencoded") {
      const form = parseFormURLEncoded(raw);
      color = normStr(form.color || "");
    } else {
      try {
        const body = raw ? JSON.parse(raw) : {};
        color = normStr(body.color || "");
      } catch {
        return json(400, { ok: false, error: "invalid_json" });
      }
    }

    const valid = validateColor(color);
    if (valid === null) {
      return json(400, { ok: false, error: "invalid_color_format", hint: "use #RRGGBB or empty to clear" });
    }

    // --- Session + CSRF ---
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

    const csrfHeader = event.headers["x-csrf"] || event.headers["X-CSRF"] || "";
    if (!CSRF_SECRET || !verifyCsrfToken(sid, csrfHeader)) {
      return json(403, { ok: false, error: "csrf_invalid" });
    }

    const clientIp = getClientIp(event);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Перевірка сесії + ролі
      const r = await client.query(
        `
        SELECT s.user_id, s.expires_at, s.revoked, u.role
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.sid = $1
        `,
        [sid]
      );
      if (!r.rowCount) { await client.query("ROLLBACK"); return json(401, { ok:false, error:"unauthorized_session", code:"no_session_row" }); }
      const row = r.rows[0];
      if (row.revoked) { await client.query("ROLLBACK"); return json(401, { ok:false, error:"unauthorized_session", code:"revoked" }); }
      if (!row.expires_at || new Date(row.expires_at) <= new Date()) { await client.query("ROLLBACK"); return json(401, { ok:false, error:"unauthorized_session", code:"expired" }); }
      if (row.role !== "admin") { await client.query("ROLLBACK"); return json(403, { ok:false, error:"forbidden" }); }

      const userId = row.user_id;

      // Rate limits
      const rlSess = await applyRateLimit(client, rlSessKey(sid), RL_SESS_LIMIT, RL_SESS_WINDOW_SEC);
      if (rlSess.limited) { await client.query("ROLLBACK"); return json(429, { ok:false, error:"rate_limited_session" }, { "Retry-After": String(rlSess.retryAfter) }); }
      const rlIp = await applyRateLimit(client, rlIpKey(clientIp), RL_IP_LIMIT, RL_IP_WINDOW_SEC);
      if (rlIp.limited) { await client.query("ROLLBACK"); return json(429, { ok:false, error:"rate_limited_ip" }, { "Retry-After": String(rlIp.retryAfter) }); }
      const rlGlob = await applyRateLimit(client, RL_GLOBAL_KEY, RL_GLOB_LIMIT, RL_GLOB_WINDOW_SEC);
      if (rlGlob.limited) { await client.query("ROLLBACK"); return json(429, { ok:false, error:"rate_limited_global" }, { "Retry-After": String(rlGlob.retryAfter) }); }

      // UPSERT у preferences за user_id
      await client.query(
        `
        INSERT INTO preferences(user_id, seen_color, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (user_id)
        DO UPDATE SET seen_color = EXCLUDED.seen_color,
                      updated_at = now()
        `,
        [userId, valid] // valid: "#RRGGBB" або "" (скидання)
      );

      await client.query("COMMIT");
      return json(200, { ok: true, seen_color: valid });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[setSeenColor] db error:", e);
      return json(500, { ok: false, error: "db_failed" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[setSeenColor] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
