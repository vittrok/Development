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
    "Content-Type, Authorization, X-Requested-With, X-CSRF",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

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
      const token = auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length).trim()
        : "";
      if (!token || token !== UPDATE_TOKEN) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
    }

    // --- Робастний парсинг JSON ---
    let raw = event.body || "";
    if (raw && event.isBase64Encoded) {
      try {
        raw = Buffer.from(raw, "base64").toString("utf8");
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

    const trigger_type = normStr(body.trigger_type) || "manual"; // 'manual' | 'cron'
    const source = normStr(body.source) || null;
    const importBatch = normStr(body.import_batch_id) || null;

    const { rows } = await pool.query(
      `SELECT run_staging_validate_and_merge($1,$2,$3) AS result`,
      [trigger_type, source, importBatch]
    );

    return json(200, {
      ok: true,
      result: rows?.[0]?.result ?? null,
      echo: { trigger_type, source, import_batch_id: importBatch },
    });
  } catch (err) {
    console.error("[update-matches] Error:", err);
    return json(500, { ok: false, error: "Internal Server Error" });
  }
};

function json(status, data) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify(data) };
}
function normStr(x) {
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t.length ? t : null;
}
