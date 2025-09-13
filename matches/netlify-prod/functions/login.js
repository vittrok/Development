// functions/login.js
// POST /login
// Архітектура v1.1: створення cookie-сесії (HttpOnly; Secure; SameSite=Lax; Max-Age=30d)
// Приймає JSON або application/x-www-form-urlencoded
// Валідація: ADMIN_USERNAME + ADMIN_PASSWORD_HASH (bcrypt). Якщо HASH відсутній — допускаємо ADMIN_PASSWORD (тільки для зручності в деві).

const { Pool } = require("pg");
const crypto = require("crypto");
const { corsHeaders } = require("./_utils"); // <<< єдине джерело CORS

let bcrypt;
try {
  bcrypt = require("bcryptjs"); // легша залежність для функцій
} catch {
  bcrypt = null;
}

function json(status, obj, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), ...extraHeaders },
    body: JSON.stringify(obj),
  };
}

function normStr(v) {
  return typeof v === "string" ? v.trim() : "";
}
function timingSafeEq(a, b) {
  const aa = Buffer.from(String(a) || "");
  const bb = Buffer.from(String(b) || "");
  if (aa.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
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

const connectionString =
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || ""; // bcrypt hash за архітектурою
const ADMIN_PASSWORD_PLAIN = process.env.ADMIN_PASSWORD || "";     // необов'язковий fallback

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// зручний хелпер для дати + N днів
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    let username = "";
    let password = "";

    const ctype = String(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "").toLowerCase();
    const raw = event.body;

    if (ctype.includes("application/x-www-form-urlencoded")) {
      const form = parseFormURLEncoded(raw);
      username = normStr(form.username);
      password = normStr(form.password);
    } else {
      try {
        const body = raw ? JSON.parse(raw) : {};
        username = normStr(body.username);
        password = normStr(body.password);
      } catch {
        return json(400, { ok: false, error: "invalid_json" });
      }
    }

    if (!username || !password) {
      return json(400, { ok: false, error: "missing_credentials" });
    }

    if (!ADMIN_USERNAME) {
      return json(500, { ok: false, error: "config_missing_admin_username" });
    }

    const userOk = timingSafeEq(username, ADMIN_USERNAME);
    let passOk = false;

    if (ADMIN_PASSWORD_HASH) {
      if (!bcrypt) {
        return json(500, { ok: false, error: "bcrypt_unavailable" });
      }
      try {
        passOk = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
      } catch {
        passOk = false;
      }
    } else if (ADMIN_PASSWORD_PLAIN) {
      passOk = timingSafeEq(password, ADMIN_PASSWORD_PLAIN);
    } else {
      return json(500, { ok: false, error: "config_missing_admin_password" });
    }

    if (!userOk || !passOk) {
      // Однакова відповідь для юзера/пароля — щоб не підказувати зловмиснику
      return json(401, { ok: false, error: "invalid_credentials" });
    }

    if (!SESSION_SECRET) {
      return json(500, { ok: false, error: "config_missing_session_secret" });
    }

    // Створюємо або знаходимо адміна; створюємо сесію
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // upsert користувача-адміна
      const u = await client.query(
        `INSERT INTO users(username, password_hash, role)
         VALUES ($1, COALESCE($2, ''), 'admin')
         ON CONFLICT (username) DO UPDATE
           SET last_login_at = NOW()
         RETURNING id`,
        [ADMIN_USERNAME, ADMIN_PASSWORD_HASH || null]
      );
      const userId = u.rows[0].id;

      // створюємо sid
      const sid = crypto.randomBytes(24).toString("base64url");
      const sig = crypto.createHmac("sha256", SESSION_SECRET).update(sid).digest("hex");
      const expiresAt = addDays(new Date(), 30);

      await client.query(
        `INSERT INTO sessions(sid, user_id, expires_at, revoked)
         VALUES ($1, $2, $3, false)`,
        [sid, userId, expiresAt.toISOString()]
      );

      await client.query("COMMIT");

      const cookie = `session=${sid}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
      return json(200, { ok: true }, { "Set-Cookie": cookie });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[login] db error:", e);
      return json(500, { ok: false, error: "db_failed" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[login] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
