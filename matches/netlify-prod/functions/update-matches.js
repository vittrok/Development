// matches/netlify-prod/functions/update-matches.js
// POST: викликає run_staging_validate_and_merge(trigger_type, source, import_batch_id)
// Робастність: підтримує body як звичайний текст і як base64 (event.isBase64Encoded=true)

const { Pool } = require("pg");

const ORIGIN = "https://football-m.netlify.app"; // прод-оригін
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, X-CSRF, X-Update-Token",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function json(status, obj) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify(obj) };
}
function normStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

const connectionString =
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const UPDATE_TOKEN = process.env.UPDATE_TOKEN || null;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    // Простий захист токеном, якщо заданий
    if (UPDATE_TOKEN) {
      const auth =
        event.headers.authorization ||
        event.headers.Authorization ||
        "";
      // NEW: підтримка X-Update-Token (альтернатива до Authorization: Bearer ...)
      const xu =
        (event.headers["x-update-token"] || event.headers["X-Update-Token"] || "").trim();

      const token = auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length).trim()
        : (xu || "");

      if (!token || token !== UPDATE_TOKEN) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
    }

    // --- Робастний парсинг JSON ---
    let raw = event.body || "";
    if (raw && event.isBase64Encoded) {
      try {
        raw = Buffer.from(raw, "utf8").toString("utf8");
      } catch (_) {
        return json(400, { ok: false, error: "Invalid JSON body (b64 decode)" });
      }
    }

    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }
    }

    const trigger_type = normStr(body.trigger_type) || "manual";
    const source = normStr(body.source) || "manual";
    const import_batch_id = normStr(body.import_batch_id) || null;

    // Виклик збереженої процедури/функції з боку БД (припускаємо наявність)
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `SELECT * FROM run_staging_validate_and_merge($1, $2, $3)`,
        [trigger_type, source, import_batch_id]
      );
      await client.query("COMMIT");
      return json(200, { ok: true, result: res.rows?.[0] || null });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[update-matches] error:", e);
      return json(500, { ok: false, error: "db_failed" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[update-matches] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
