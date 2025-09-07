// matches/netlify-prod/functions/import-to-staging.js
// POST: додає записи у staging_matches (без мерджу).
// Тіло: масив матчів, або { matches: [...] }, або один об'єкт.
// Робастний парсинг (base64, BOM), зрозумілі помилки.

const { Pool } = require("pg");
const ORIGIN = "https://football-m.netlify.app";
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
const UPDATE_TOKEN = process.env.UPDATE_TOKEN || null;

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

    // Auth: той самий токен, що й у update-matches
    if (UPDATE_TOKEN) {
      const h = event.headers.authorization || event.headers.Authorization || "";
      const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
      if (!token || token !== UPDATE_TOKEN) return json(401, { ok: false, error: "Unauthorized" });
    }

    // --- Парсинг JSON (base64 + BOM safe) ---
    let raw = event.body || "";
    if (raw && event.isBase64Encoded) {
      try { raw = Buffer.from(raw, "base64").toString("utf8"); }
      catch { return json(400, { ok: false, error: "Invalid JSON body (b64 decode)" }); }
    }
    if (raw && raw.charCodeAt && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // зняти BOM

    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { return json(400, { ok: false, error: "Invalid JSON body" }); }

    // Нормалізація вхідних даних до масиву
    let arr = [];
    if (Array.isArray(body)) arr = body;
    else if (body && Array.isArray(body.matches)) arr = body.matches;
    else if (body && typeof body === "object" && Object.keys(body).length) arr = [body];

    if (!Array.isArray(arr) || arr.length === 0) {
      return json(400, { ok: false, error: "No items provided" });
    }

    // Мінімальна валідація + whitelist
    const cleaned = [];
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      const item = {
        kickoff_at:      normStr(it.kickoff_at),
        league:          normStr(it.league),
        status:          normStr(it.status),
        home_team:       normStr(it.home_team),
        away_team:       normStr(it.away_team),
        source:          normStr(it.source),
        import_batch_id: normStr(it.import_batch_id),
        link:            normStr(it.link),
        tournament:      normStr(it.tournament),
        rank:            toInt(it.rank),
      };
      // обов'язкові поля
      if (!item.kickoff_at || !item.home_team || !item.away_team) continue;
      cleaned.push(item);
    }
    if (cleaned.length === 0) {
      return json(400, { ok: false, error: "No valid items" });
    }

    // Вставка: безпечна, без jsonb_to_recordset — через jsonb_array_elements + явні касти
    const q = `
      WITH src AS (SELECT $1::jsonb AS j),
      rows AS (
        SELECT
          NULLIF(elem->>'kickoff_at','')::timestamptz  AS kickoff_at,
          NULLIF(elem->>'league','')                   AS league,
          NULLIF(elem->>'status','')                   AS status,
          NULLIF(elem->>'home_team','')                AS home_team,
          NULLIF(elem->>'away_team','')                AS away_team,
          NULLIF(elem->>'source','')                   AS source,
          NULLIF(elem->>'import_batch_id','')          AS import_batch_id,
          NULLIF(elem->>'link','')                     AS link,
          NULLIF(elem->>'tournament','')               AS tournament,
          NULLIF(elem->>'rank','')::int                AS rank
        FROM src, jsonb_array_elements(src.j) elem
      ),
      ins AS (
        INSERT INTO staging_matches
          (kickoff_at, league, status, home_team, away_team, source, import_batch_id, link, tournament, rank)
        SELECT kickoff_at, league, status, home_team, away_team, source, import_batch_id, link, tournament, rank
        FROM rows
        WHERE kickoff_at IS NOT NULL AND home_team IS NOT NULL AND away_team IS NOT NULL
        RETURNING id
      )
      SELECT COUNT(*)::int AS inserted FROM ins;
    `;

    const { rows } = await pool.query(q, [JSON.stringify(cleaned)]);
    const inserted = rows?.[0]?.inserted ?? 0;

    return json(200, { ok: true, inserted });
  } catch (err) {
    console.error("[import-to-staging] Error:", err);
    // Тимчасово повернемо повідомлення (ендпоїнт захищений токеном)
    return json(500, { ok: false, error: "Internal Server Error", message: String(err && err.message || err) });
  }
};

function json(status, data) { return { statusCode: status, headers: corsHeaders, body: JSON.stringify(data) }; }
function normStr(x) { if (typeof x !== "string") return null; const t = x.trim(); return t.length ? t : null; }
function toInt(x) { const n = Number(x); return Number.isFinite(n) ? Math.trunc(n) : null; }
