// POST /login
// Архітектура v1.1: створення cookie-сесії (HttpOnly; Secure; SameSite=Lax; Max-Age=30d)
// Приймає JSON або application/x-www-form-urlencoded
// Валідація: ADMIN_USERNAME + ADMIN_PASSWORD_HASH (bcrypt). Якщо HASH відсутній — допускаємо ADMIN_PASSWORD (лише для зручності).

const { Pool } = require("pg");
const crypto = require("crypto");

let bcrypt;
try {
  bcrypt = require("bcryptjs"); // легша залежність для функцій
} catch {
  bcrypt = null;
}

const ORIGIN = "https://football-m.netlify.app";
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-CSRF",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  Vary: "Origin",
};

function json(status, obj, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...corsHeaders, ...extraHeaders },
    body: JSON.stringify(obj),
  };
}

function hmacHex(secret, data) {
  return crypto.createHmac("sha256", String(secret)).update(String(data)).digest("hex");
}

function timingSafeEq(a, b) {
  const aa = Buffer.from(String(a) || "");
  const bb = Buffer.from(String(b) || "");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function normStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function parseFormURLEncoded(body) {
  const out = {};
  for (const kv of body.split("&")) {
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
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    // --- Робастний парсинг тіла ---
    const ctRaw = event.headers["content-type"] || event.headers["Content-Type"] || "";
    const ctype = ctRaw.split(";")[0].trim().toLowerCase();

    let raw = event.body || "";
    if (raw && event.isBase64Encoded) {
      // Netlify інколи передає base64; декодуємо як utf8
      try {
        raw = Buffer.from(raw, "base64").toString("utf8");
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body (b64 decode)" });
      }
    }

    let username = "";
    let password = "";

    if (ctype === "application/x-www-form-urlencoded") {
      const form = parseFormURLEncoded(raw);
      username = normStr(form.username);
      password = normStr(form.password);
    } else {
      // за замовчанням очікуємо JSON
      try {
        const body = raw ? JSON.parse(raw) : {};
        username = normStr(body.username);
        password = normStr(body.password);
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }
    }

    if (!username || !password) {
      return json(400, { ok: false, error: "missing_credentials" });
    }

    // --- Перевірка логіна ---
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
      return json(500, { ok: false, error: "config_missing_password" });
    }

    if (!userOk || !passOk) {
      // навмисно не уточнюємо, що саме не так
      return json(401, { ok: false, error: "invalid_credentials" });
    }

    // --- Створення/запис сесії ---
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // знаходимо користувача (admin), або створимо якщо немає
      const u = await client.query(`SELECT id, role FROM users WHERE username = $1`, [ADMIN_USERNAME]);
      let userId;
      if (u.rowCount) {
        userId = u.rows[0].id;
      } else {
        const ins = await client.query(
          `INSERT INTO users(username, password_hash, role, created_at)
           VALUES ($1, $2, 'admin', now())
           RETURNING id`,
          [ADMIN_USERNAME, ADMIN_PASSWORD_HASH || null]
        );
        userId = ins.rows[0].id;
      }

      // робимо нову сесію на 30 днів
      const sid = crypto.randomUUID();
      const sig = hmacHex(SESSION_SECRET, sid);
      const issuedAt = new Date();
      const expiresAt = addDays(issuedAt, 30);

      await client.query(
        `
        INSERT INTO sessions(sid, user_id, issued_at, expires_at, revoked)
        VALUES ($1, $2, now(), $3, false)
        `,
        [sid, userId, expiresAt.toISOString()]
      );

      await client.query(
        `UPDATE users SET last_login_at = now() WHERE id = $1`,
        [userId]
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
