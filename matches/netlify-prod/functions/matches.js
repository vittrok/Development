// matches/netlify-prod/functions/matches.js

const { Pool } = require("pg");

// --- DB connection ---
const connectionString =
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

if (!connectionString) {
  console.warn(
    "[matches] Missing DATABASE_URL/NEON_DATABASE_URL. Set it in Netlify env."
  );
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Neon/managed PG зазвичай вимагає SSL
});

// --- CORS ---
const ORIGIN = "https://football-m.netlify.app"; // прод-оригін
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-CSRF",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return resp(
      405,
      { ok: false, error: "Method Not Allowed" },
      corsHeaders
    );
  }

  try {
    const qp = event.queryStringParameters || {};

    const league = normStr(qp.league);
    const team = normStr(qp.team);

    // Новий фільтр: status=scheduled|finished (інші значення ігноруємо)
    const status = parseStatus(qp.status);

    const sort = qp.sort === "kickoff_asc" ? "kickoff_asc" : "kickoff_desc";

    // limit: 1..100 (дефолт 50)
    let limit = parseInt(qp.limit, 10);
    if (!Number.isFinite(limit)) limit = 50;
    limit = Math.max(1, Math.min(100, limit));

    // offset: 0..∞
    let offset = parseInt(qp.offset, 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    // --- build SQL ---
    const where = [];
    const values = [];

    if (league) {
      values.push(league);
      where.push(`league = $${values.length}`);
    }

    if (team) {
      values.push(team);
      const idx = values.length;
      where.push(`(home_team = $${idx} OR away_team = $${idx})`);
    }

    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }

    const orderBy =
      sort === "kickoff_asc" ? `kickoff_at ASC` : `kickoff_at DESC`;

    // whitelist полів — без score-полів
    let sql = `
      SELECT
        id,
        kickoff_at,
        league,
        home_team,
        away_team,
        status,
        venue,
        COALESCE(metadata, '{}'::jsonb) AS metadata,
        created_at,
        updated_at
      FROM matches
    `;

    if (where.length) {
      sql += ` WHERE ${where.join(" AND ")} `;
    }

    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    sql += ` ORDER BY ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx} `;

    const { rows } = await pool.query(sql, values);

    // Додатковий запобіжник — навіть якщо колись з'являться score-поля в SELECT:
    const items = rows.map(({ home_score, away_score, ...rest }) => rest);

    return resp(
      200,
      {
        ok: true,
        items,
        limit,
        offset,
        sort,
        // Якщо статус переданий — повернемо його у відповідь як echo
        ...(status ? { filter: { status } } : {}),
      },
      corsHeaders
    );
  } catch (err) {
    console.error("[matches] Error:", err);
    return resp(
      500,
      { ok: false, error: "Internal Server Error" },
      corsHeaders
    );
  }
};

// --- helpers ---
function resp(statusCode, body, headers) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

function normStr(x) {
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t.length ? t : null;
}

function parseStatus(x) {
  if (typeof x !== "string") return null;
  const t = x.trim().toLowerCase();
  if (t === "scheduled" || t === "finished") return t;
  return null; // невідоме значення ігноруємо
}
