// functions/import-to-staging.js
// Netlify Function: POST /.netlify/functions/import-to-staging
// Requires: UPDATE_TOKEN, APP_ORIGIN, DATABASE_URL (Postgres/Neon)

import crypto from "node:crypto";
import { Pool } from "pg";

const { UPDATE_TOKEN, APP_ORIGIN, DATABASE_URL } = process.env;

let _pool;
function getPool() {
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  _pool.on("error", (err) => console.error("[pg] pool error:", err));
  return _pool;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": APP_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, X-CSRF",
  "Access-Control-Allow-Credentials": "true",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Cache-Control": "no-cache",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}
const unauthorized = () => json(401, { ok: false, error: "Unauthorized" });
const badRequest  = (m="Invalid JSON body") => json(400, { ok:false, error:"Invalid JSON body", message:m });
const internalErr = (m="Internal Server Error") => json(500, { ok:false, error:"Internal Server Error", message:m });

function readBearer(event) {
  const h = event.headers || {};
  const a = h.authorization || h.Authorization || "";
  if (!a.startsWith("Bearer ")) return null;
  return a.slice(7).trim();
}
function checkToken(event) {
  if (!UPDATE_TOKEN) return false;
  const tok = readBearer(event);
  if (!tok) return false;
  const a = Buffer.from(tok), b = Buffer.from(UPDATE_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseBody(event) {
  const ct = (event.headers?.["content-type"] || event.headers?.["Content-Type"] || "").split(";")[0].trim();
  const raw = event.body ?? "";
  if (!raw) return { matches: [] };
  try {
    if (ct === "application/json") {
      const s = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
      return JSON.parse(s);
    } else if (ct === "text/plain") {
      // text/plain містить base64 JSON
      const decoded = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
      const jsonStr = Buffer.from(decoded, "base64").toString("utf8");
      return JSON.parse(jsonStr);
    } else {
      const buf = event.isBase64Encoded ? Buffer.from(raw, "base64") : Buffer.from(raw);
      return JSON.parse(buf.toString("utf8"));
    }
  } catch (e) {
    throw new Error(`Parse error: ${e.message}`);
  }
}

function normalizeMatch(x) {
  if (!x || typeof x !== "object") throw new Error("Item must be an object");
  const league = String(x.league ?? "").trim();
  const home_team = String(x.home_team ?? "").trim();
  const away_team = String(x.away_team ?? "").trim();
  const status = String(x.status ?? "").trim();
  const kickoff_raw = x.kickoff_at ?? x.kickoffAt ?? x.kickoff;
  if (!league) throw new Error("league is required");
  if (!home_team) throw new Error("home_team is required");
  if (!away_team) throw new Error("away_team is required");
  if (!status) throw new Error("status is required");
  if (!kickoff_raw) throw new Error("kickoff_at is required");
  const kickoff = new Date(kickoff_raw);
  if (isNaN(kickoff.getTime())) throw new Error("kickoff_at must be a valid date");
  const kickoff_at = kickoff.toISOString();
  const venue = x.venue == null ? null : String(x.venue).trim() || null;
  const metadata = x.metadata && typeof x.metadata === "object" ? x.metadata : {};
  return { league, home_team, away_team, status, kickoff_at, venue, metadata };
}

async function getStagingColumns(client) {
  // Витягуємо реальні колонки таблиці staging_matches
  const { rows } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staging_matches'`
  );
  return new Set(rows.map(r => r.column_name));
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: CORS_HEADERS, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return json(405, { ok:false, error:"Method Not Allowed" });
    }
    if (!checkToken(event)) {
      return unauthorized();
    }

    let payload;
    try { payload = parseBody(event); } catch(e) { return badRequest(e.message); }
    const input = Array.isArray(payload) ? payload : payload?.matches;
    if (!Array.isArray(input)) return badRequest("Body must be an array or {matches:[...]}");
    if (input.length === 0) return json(200, { ok:true, import_batch_id:null, count:0 });

    let normalized;
    try { normalized = input.map(normalizeMatch); } catch(e) { return badRequest(e.message); }

    const importBatchId = crypto.randomUUID();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // зчитуємо доступні колонки
      const cols = await getStagingColumns(client);

      // базові колонки — очікується, що вони є
      const insertCols = ["import_batch_id", "league", "home_team", "away_team", "kickoff_at", "status"];

      // опційні
      if (cols.has("venue")) insertCols.push("venue");
      if (cols.has("metadata")) insertCols.push("metadata");

      // готуємо INSERT
      const baseParams = (m) => [
        importBatchId,
        m.league,
        m.home_team,
        m.away_team,
        m.kickoff_at,
        m.status,
      ];
      const buildValues = (m) => {
        const vals = baseParams(m);
        if (cols.has("venue")) vals.push(m.venue);
        if (cols.has("metadata")) vals.push(JSON.stringify(m.metadata));
        return vals;
      };

      const placeholders = (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(",");
      const text = `
        INSERT INTO staging_matches (${insertCols.join(",")})
        VALUES (${placeholders(insertCols.length)})
      `;

      for (const m of normalized) {
        await client.query(text, buildValues(m));
      }

      await client.query("COMMIT");
      return json(200, { ok:true, import_batch_id: importBatchId, count: normalized.length });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[import-to-staging] DB error:", e);
      return internalErr(e.message);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[import-to-staging] Fatal error:", e);
    return internalErr(e.message);
  }
}
