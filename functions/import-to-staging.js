// functions/import-to-staging.js
// Netlify Function: POST /.netlify/functions/import-to-staging
// Requires: UPDATE_TOKEN, APP_ORIGIN, DATABASE_URL (Postgres/Neon)

import crypto from "node:crypto";
import { Pool } from "pg";

/** ---------- ENV & DB ---------- */
const {
  UPDATE_TOKEN,
  APP_ORIGIN,
  DATABASE_URL,
  NODE_ENV,
} = process.env;

if (!APP_ORIGIN) {
  console.warn("[import-to-staging] APP_ORIGIN is not set");
}
if (!UPDATE_TOKEN) {
  console.warn("[import-to-staging] UPDATE_TOKEN is not set");
}
if (!DATABASE_URL) {
  console.warn("[import-to-staging] DATABASE_URL is not set");
}

let _pool;
/** Singleton PG pool */
function getPool() {
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // Neon friendly
    },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  _pool.on("error", (err) => {
    console.error("[pg] pool error:", err);
  });
  return _pool;
}

/** ---------- Helpers ---------- */

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
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

function unauthorized() {
  return json(401, { ok: false, error: "Unauthorized" });
}

function badRequest(message = "Invalid JSON body") {
  return json(400, { ok: false, error: "Invalid JSON body", message });
}

function internalError(message = "Internal Server Error") {
  return json(500, { ok: false, error: "Internal Server Error", message });
}

/** Parse body:
 * - when "application/json": parse JSON
 * - when "text/plain": treat as base64 and decode to utf8 JSON
 */
function parseBody(event) {
  const ct = (event.headers?.["content-type"] ||
    event.headers?.["Content-Type"] ||
    "")
    .split(";")[0]
    .trim();

  const raw = event.body ?? "";
  if (!raw) return { matches: [] };

  try {
    if (ct === "application/json") {
      const obj = JSON.parse(event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw);
      return obj;
    } else if (ct === "text/plain") {
      const decoded = event.isBase64Encoded
        ? Buffer.from(raw, "base64").toString("utf8")
        : raw;
      const jsonStr = Buffer.from(decoded, "base64").toString("utf8");
      return JSON.parse(jsonStr);
    } else {
      // try best-effort JSON
      const buf = event.isBase64Encoded ? Buffer.from(raw, "base64") : Buffer.from(raw);
      return JSON.parse(buf.toString("utf8"));
    }
  } catch (e) {
    throw new Error(`Parse error: ${e.message}`);
  }
}

/** Minimal record validation + normalization */
function normalizeMatch(x) {
  if (!x || typeof x !== "object") throw new Error("Item must be an object");
  const league = String(x.league ?? "").trim();
  const home_team = String(x.home_team ?? "").trim();
  const away_team = String(x.away_team ?? "").trim();
  const status = String(x.status ?? "").trim();
  const kickoff_at_raw = x.kickoff_at ?? x.kickoffAt ?? x.kickoff;

  if (!league) throw new Error("league is required");
  if (!home_team) throw new Error("home_team is required");
  if (!away_team) throw new Error("away_team is required");
  if (!status) throw new Error("status is required");
  if (!kickoff_at_raw) throw new Error("kickoff_at is required");

  // Normalize time to ISO8601 Z
  const kickoff = new Date(kickoff_at_raw);
  if (isNaN(kickoff.getTime())) {
    throw new Error("kickoff_at must be a valid date");
  }
  const kickoff_at = kickoff.toISOString();

  const venue = x.venue == null ? null : String(x.venue).trim() || null;
  const metadata =
    x.metadata && typeof x.metadata === "object" ? x.metadata : {};

  return {
    league,
    home_team,
    away_team,
    status,
    kickoff_at,
    venue,
    metadata,
  };
}

/** ---------- Auth ---------- */
function readBearer(event) {
  const h = event.headers || {};
  const auth =
    h.authorization ||
    h.Authorization ||
    "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

function checkToken(event) {
  const token = readBearer(event);
  if (!token || !UPDATE_TOKEN) return false;
  // constant-time compare
  const a = Buffer.from(token);
  const b = Buffer.from(UPDATE_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** ---------- Handler ---------- */

export async function handler(event) {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: "",
      };
    }

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    // Auth (prod reality: token is required)
    if (!checkToken(event)) {
      return unauthorized();
    }

    // Parse & validate body
    let payload;
    try {
      payload = parseBody(event);
    } catch (e) {
      return badRequest(e.message);
    }

    // Accept: { matches: [...] } OR [...]
    const input = Array.isArray(payload) ? payload : payload?.matches;
    if (!Array.isArray(input)) {
      return badRequest("Body must be an array or {matches:[...]}");
    }
    if (input.length === 0) {
      return json(200, { ok: true, import_batch_id: null, count: 0 });
    }

    // Normalize
    let normalized;
    try {
      normalized = input.map(normalizeMatch);
    } catch (e) {
      return badRequest(e.message);
    }

    // DB insert with ONE import_batch_id for the whole call
    const importBatchId = crypto.randomUUID();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const text = `
        INSERT INTO staging_matches (
          import_batch_id,
          league, home_team, away_team, kickoff_at, status, venue, metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `;
      for (const m of normalized) {
        const values = [
          importBatchId,
          m.league,
          m.home_team,
          m.away_team,
          m.kickoff_at,
          m.status,
          m.venue,
          JSON.stringify(m.metadata),
        ];
        await client.query(text, values);
      }
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      // Surface common constraint messages as-is to caller for faster ops
      console.error("[import-to-staging] DB error:", e);
      return internalError(e.message);
    } finally {
      client.release();
    }

    return json(200, {
      ok: true,
      import_batch_id: importBatchId,
      count: normalized.length,
    });
  } catch (e) {
    console.error("[import-to-staging] Fatal error:", e);
    return internalError(e.message);
  }
}
