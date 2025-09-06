// functions/matches.js
/* eslint-disable */
const { corsHeaders, getPool } = require('./_utils');

const pool = getPool();

function parseList(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val;
  return String(val)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  try {
    const qs = event.queryStringParameters || {};

    // фільтри
    const dateFrom = qs.date_from || null; // ISO-строка
    const dateTo   = qs.date_to   || null;

    const leagues  = parseList(qs.league);
    const statuses = parseList(qs.status);

    const teamLike = qs.team ? String(qs.team).trim() : null;
    const q        = qs.q    ? String(qs.q).trim()    : null;

    // пагінація/сорт
    let limit = Number.parseInt(qs.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 20;
    if (limit > 100) limit = 100;

    let offset = Number.parseInt(qs.offset, 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const sort = (qs.sort || 'kickoff_asc').toLowerCase();
    const orderBy = sort === 'kickoff_desc'
      ? 'kickoff_at DESC, id DESC'
      : 'kickoff_at ASC, id ASC';

    // WHERE
    const where = [];
    const params = [];

    if (dateFrom) {
      params.push(dateFrom);
      where.push(`kickoff_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      where.push(`kickoff_at <= $${params.length}`);
    }
    if (leagues && leagues.length) {
      params.push(leagues);
      where.push(`league = ANY($${params.length})`);
    }
    if (statuses && statuses.length) {
      params.push(statuses);
      where.push(`status = ANY($${params.length})`);
    }
    if (teamLike) {
      params.push(`%${teamLike}%`);
      params.push(`%${teamLike}%`);
      where.push(`(home_team ILIKE $${params.length - 1} OR away_team ILIKE $${params.length})`);
    }
    if (q) {
      params.push(`%${q}%`);
      params.push(`%${q}%`);
      params.push(`%${q}%`);
      where.push(`(league ILIKE $${params.length - 2} OR home_team ILIKE $${params.length - 1} OR away_team ILIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    params.push(limit);
    params.push(offset);

    const sql = `
      SELECT id, kickoff_at, league, home_team, away_team, status,
             home_score, away_score, venue, metadata, created_at, updated_at
      FROM matches
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const { rows } = await pool.query(sql, params);

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, items: rows, limit, offset, sort }),
    };
  } catch (e) {
    console.error('[/matches GET] error:', e);
    return { statusCode: 500, headers: corsHeaders(), body: 'matches failed' };
  }
};
