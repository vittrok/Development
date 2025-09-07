// matches/netlify-prod/functions/import-to-staging.js
// POST: додає записи у staging_matches (без мерджу).
// Тіло: масив об'єктів або { matches: [...] }.
// Підтримує base64-тіло (Netlify).

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

    // auth by token (same as update-matches)
    if (UPDATE_TOKEN) {
      const h = event.headers.authorization || event.headers.Authorization || "";
      const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
      if (!token || token !== UPDATE_TOKEN) return json(401, { ok: false, error: "Unauthorized" });
    }

    // robust body parsing (supports base64, strips BOM)
    let raw = event.body || "";
    if (raw && event.isBase64Encoded) {
      try { raw = Buffer.from(raw, "base64").toString("utf8"); }
      catch { return json(400, { ok: false, error: "Invalid JSON body (b64 decode)" }); }
    }
    if (raw && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { return json(400, { ok: false, error: "Invalid JSON body" }); }

    // normalize payload
    let arr = Array.isArray(body) ? body : (Array.isArray(body.matches) ? body.matches : (body && typeof body === "object" ? [body] : []));
    if (!Array.isArray(arr) || arr.length === 0) return json(400, { ok: false, error: "No items provided" });

    // whitelist + minimal validation
    const cleaned = [];
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      const obj = {
        kickoff_at:   normStr(it.kickoff_at),   // ISO, '2025-10-05T14:00:00Z', etc.
        league:       normStr(it.league),
        status:       normStr(it.status),
        home_team:    normStr(it.home_team),
        away_team:    normStr(it.away_team),
        source:       normStr(it.source),
        import_batch_id: normStr(it.import_batch_id),
        link:         normStr(it.link),
        tournament:   normStr(it.tournament),
        rank:         toInt(it.rank),
      };
      // required minimal fields
      if (!obj.kickoff_at || !obj.home_team || !obj.away_team) continue;
      cleaned.push(obj);
    }
    if (cleaned.length === 0) return json(400, { ok: false, error: "No valid items" });

    // insert in one shot via jsonb_to_recordset
    const { rows } = await pool.query(
      `
      WITH src AS (SELECT $1::jsonb AS j),
      ins AS (
        INSERT INTO staging_matches
          (kickoff_at, league, status, home_team, away_team, source, import_batch_id, link, tournament, rank)
        SELECT x.kickoff_at, x.league, x.status, x.home_team, x.away_team, x.source, x.import_batch_id, x.link, x.tournament, x.rank
        FROM src, jsonb_to_recordset(src.j)
          AS x(kickoff_at timestamptz, league text, status text, home_team text, away_team text, source text, import_batch_id text, link text, tournament text, rank int)
        RETURNING id
      )
      SELECT COUNT(*)::int AS inserted FROM ins;
      `,
      [JSON.stringify(cleaned)]
    );

    return json(200, { ok: true, inserted: rows?.[0]?.inserted ?? 0 });
  } catch (err) {
    console.error("[import-to-staging] Error:", err);
    return json(500, { ok: false, error: "Internal Server Error" });
  }
};

function json(status, data) { return { statusCode: status, headers: corsHeaders, body: JSON.stringify(data) }; }
function normStr(x) { if (typeof x !== "string") return null; const t = x.trim(); return t.length ? t : null; }
function toInt(x) { const n = Number(x); return Number.isFinite(n) ? Math.trunc(n) : null; }
