// functions/getMatches.js
// Публічний ендпоїнт: анонімам — дефолтні префи; авторизованим — префи з user_preferences.
// Архітектура v1.1: CORS через _utils.corsHeaders(), PG через _utils.getPool().
// 18.4.H1 — Пагінація (limit/offset) з валідацією параметрів.

const { corsHeaders, getPool } = require("./_utils");

const pool = getPool();

// --- allowed sort ---
const SORT_WHITELIST = new Set([
  "kickoff_at",
  "home_team",
  "away_team",
  "tournament",
  "status",
  "league",
]);

const ORDER_WHITELIST = new Set(["asc", "desc"]);

// --- helpers ---
function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(bodyObj),
  };
}

// very small cookie parser (без залежностей)
function parseCookies(event) {
  const out = {};
  const header =
    (event && event.headers && (event.headers.cookie || event.headers.Cookie)) ||
    "";
  if (!header) return out;
  String(header)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
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

const DEFAULT_PREFS = Object.freeze({
  sort_col: "kickoff_at",
  sort_order: "asc",
  seen_color: "#ffffcc",
});

async function getPrefs(client, userId) {
  // Анонімам — дефолти
  if (!userId) return DEFAULT_PREFS;

  const { rows } = await client.query(
    `select data
       from user_preferences
      where user_id = $1
      limit 1`,
    [userId]
  );

  if (!rows.length || !rows[0].data) return DEFAULT_PREFS;

  const merged = { ...DEFAULT_PREFS, ...rows[0].data };
  const col = SORT_WHITELIST.has(merged.sort_col) ? merged.sort_col : "kickoff_at";
  const ord = ORDER_WHITELIST.has(String(merged.sort_order).toLowerCase())
    ? String(merged.sort_order).toLowerCase()
    : "asc";
  return { ...merged, sort_col: col, sort_order: ord };
}

function toIntOrDefault(x, dflt) {
  const n = parseInt(x, 10);
  if (!Number.isFinite(n)) return dflt;
  return n;
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
      const sid = getSidFromCookie(event);
      const userId = await findUserIdBySid(client, sid);
      const prefs = await getPrefs(client, userId);

      // --- пагінація: валідація ---
      const qp = event.queryStringParameters || {};
      let limit = toIntOrDefault(qp.limit, 50);
      let offset = toIntOrDefault(qp.offset, 0);

      if (!Number.isFinite(limit) || limit <= 0) limit = 50;
      // обмежуємо, щоб не віддавати величезні масиви
      if (limit > 200) limit = 200;

      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const orderCol = SORT_WHITELIST.has(prefs.sort_col)
        ? prefs.sort_col
        : "kickoff_at";
      const orderDir = ORDER_WHITELIST.has(prefs.sort_order)
        ? prefs.sort_order
        : "asc";

      const sql = `
        select
          id,
          kickoff_at,
          home_team,
          away_team,
          tournament,
          status,
          league
        from matches
        order by ${orderCol} ${orderDir}
        limit $1 offset $2
      `;

      // запитуємо на один запис більше, щоб визначити has_more
      const { rows } = await client.query(sql, [limit + 1, offset]);
      const has_more = rows.length > limit;
      const items = has_more ? rows.slice(0, limit) : rows;

      return json(200, {
        ok: true,
        items,
        prefs,
        page: {
          limit,
          offset,
          next_offset: offset + items.length,
          has_more,
        },
      });
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
