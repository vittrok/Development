// matches/netlify-prod/functions/update-matches.js
// POST: викликає run_staging_validate_and_merge(trigger_type, source, import_batch_id)
// Працює і коли staging порожній (ідемпотентно).

const { Pool } = require("pg");

const ORIGIN = "https://football-m.netlify.app"; // прод-оригін
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-CSRF",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const UPDATE_TOKEN = process.env.UPDATE_TOKEN || null; // якщо задано — вимагаємо Bearer токен

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

    // Простий захист: якщо UPDATE_TOKEN задано — вимагаємо Authorization: Bearer <token>
    if (UPDATE_TOKEN) {
      const auth = event.headers.authorization || event.headers.Authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
      if (!token || token !== UPDATE_TOKEN) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
    }

    let body = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }
    }

    const trigger_type = normStr(body.trigger_type) || "manual";        // 'manual' | 'cron'
    const source       = normStr(body.source)       || null;             // довільний ідентифікатор джерела
    const importBatch  = normStr(body.import_batch_id) || null;          // довільний batch-id

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
