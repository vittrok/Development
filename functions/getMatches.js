// functions/getMatches.js
// Публічний ендпоїнт: анонімам — дефолтні префи; авторизованим — префи з user_preferences.
// Архітектура v1.1: CORS через _utils.corsHeaders(), PG через _utils.getPool().
// Немає залежності від requireAuth — аноніми дозволені.

const { corsHeaders, getPool } = require("./_utils");

const pool = getPool();

const SORT_WHITELIST = new Set([
  "kickoff_at",
  "home_team",
  "away_team",
  "tournament",
  "status",
  "league",
]);
const ORDER_WHITELIST = new Set(["asc", "desc"]);

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function parseCookies(event) {
  const h = event?.headers || {};
  const raw = h["cookie"] || h["Cookie"] || "";
  const out = {};
  String(raw)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        out[k] = v;
      }
    });
  return out;
}

// Витягуємо чистий sid з кукі "session=<sid>.<sig>"
function getSidFromCookie(event) {
  const c = parseCookies(event);
  const v = c["session"];
  if (!v) return null;
  const dot = v.indexOf(".");
  if (dot <= 0) return null;
  return v.slice(0, dot); // тільки sid (без підпису)
}

async function findUserIdBySid(client, sid) {
  if (!sid) return null;
  const { rows } = await client.query(
    `select user_id, revoked, expires_at
       from sessions
      where sid = $1
      limit 1`,
    [sid]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (r.revoked) return null;
  if (!r.expires_at || new Date(r.expires_at) <= new Date()) return null;
  return r.user_id || null;
}

async function readPrefs(client, userId) {
  const defaults = { sort_col: "kickoff_at", sort_order: "asc" };
  if (!userId) return defaults;

  const { rows } = await client.query(
    `select data
       from user_preferences
      where user_id = $1
      limit 1`,
    [userId]
  );

  if (!rows.length || !rows[0].data) return defaults;

  const merged = { ...defaults, ...rows[0].data };
  const col = SORT_WHITELIST.has(merged.sort_col) ? merged.sort_col : "kickoff_at";
  const ord = ORDER_WHITELIST.has(String(merged.sort_order).toLowerCase())
    ? String(merged.sort_order).toLowerCase()
    : "asc";
  return { ...merged, sort_col: col, sort_order: ord };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    const client = await pool.connect();
    try {
      const sid = getSidFromCookie(event);          // може бути null (анонім)
      const userId = await findUserIdBySid(client, sid);
      const prefs = await readPrefs(client, userId);

      const orderCol = prefs.sort_col;
      const orderDir = prefs.sort_order;
      const orderBySql = `order by ${orderCol} ${orderDir}`;

      const { rows } = await client.query(
        `
        select
          id,
          kickoff_at,
          home_team,
          away_team,
          tournament,
          status,
          league
        from matches
        ${orderBySql}
        limit 1000
        `
      );

      return json(200, { ok: true, items: rows, prefs });
    } catch (err) {
      console.error("getMatches error:", err);
      return json(500, { ok: false, error: "server_error" });
    } finally {
      if (typeof client?.release === "function") client.release();
    }
  } catch (e) {
    console.error("getMatches fatal:", e);
    return json(500, { ok: false, error: "server_error" });
  }
};
