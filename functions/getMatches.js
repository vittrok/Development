// matches/netlify-prod/functions/getMatches.js
// Мікрокрок 18.4.0.15: розширена діагностика (path/rawUrl), бізнес-логіку НЕ змінюємо.

const { requireAuth, corsHeaders } = require('./_utils');
const { getClient } = require('./_db');

async function coreGetMatches() {
  const client = getClient();
  try {
    await client.connect();

    const p = await client.query("SELECT sort_col, sort_order FROM preferences LIMIT 1");

    let sortCol = 'date', sortOrder = 'asc';
    const allowed = ['rank','match','tournament','date','link','seen','comments'];
    if (p.rowCount) {
      const col = p.rows[0].sort_col;
      const ord = p.rows[0].sort_order;
      if (allowed.includes(col)) sortCol = col;
      if (ord === 'desc') sortOrder = 'desc';
    }

    const rows = await client.query(`
      SELECT rank, match, tournament, date, link, seen, comments
      FROM matches
      ORDER BY ${sortCol} ${sortOrder} NULLS LAST, rank ASC
    `);

    const matches = rows.rows.map(r => ({
      rank: r.rank,
      match: r.match,
      tournament: r.tournament,
      date: r.date instanceof Date ? r.date.toISOString().slice(0,10) : r.date,
      link: r.link,
      seen: r.seen,
      comments: r.comments
    }));

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ matches, sort: { column: sortCol, order: sortOrder } })
    };
  } finally {
    await client.end();
  }
}

// Підтримка обох сигнатур requireAuth
function wrapAuth(handler) {
  try {
    const maybe = requireAuth(handler);
    if (typeof maybe === 'function') return maybe;
    return async (event, context) => await requireAuth(event, context, handler);
  } catch {
    return async (event, context) => await requireAuth(event, context, handler);
  }
}

const guarded = wrapAuth(async () => coreGetMatches());

exports.handler = async function handler(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  // Діагностика (НЕ світимо значення)
  try {
    const h = event.headers || {};
    const hasCookie   = typeof h.cookie === 'string' && /session=/.test(h.cookie);
    const hasCsrfHdr  = typeof h['x-csrf'] === 'string' && h['x-csrf'].length > 0;
    const hasXReq     = typeof h['x-requested-with'] === 'string';
    const hasOrigin   = typeof h['origin'] === 'string';
    const hasReferer  = typeof h['referer'] === 'string';
    console.log(
      '[getMatches] diag:',
      JSON.stringify({
        method: event.httpMethod,
        path: event.path,
        rawUrl: event.rawUrl,
        hasCookie, hasCsrfHdr, hasXReq, hasOrigin, hasReferer
      })
    );
  } catch (e) {
    console.warn('[getMatches] diag logging failed:', String(e?.message || e));
  }

  try {
    const res = await guarded(event, context);

    if (res && typeof res.statusCode === 'number' && res.statusCode >= 400) {
      let preview = '';
      try {
        const b = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? '');
        preview = b.slice(0, 160);
      } catch {}
      console.warn('[getMatches] guarded returned non-2xx:', { statusCode: res.statusCode, bodyPreview: preview });
    }

    return { ...res, headers: { ...corsHeaders(), ...(res.headers || {}) } };
  } catch (e) {
    const msg = String(e?.message || e);
    const is401 = /unauthorized|401/i.test(msg);
    if (is401) {
      console.warn('[getMatches] auth rejected (thrown):', msg);
      return { statusCode: 401, headers: corsHeaders(), body: 'unauthorized' };
    }
    console.error('[getMatches] error:', msg);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ ok:false, error: msg }) };
  }
};
// Мікрокрок 18.4.0.15: розширена діагностика (path/rawUrl), бізнес-логіку НЕ змінюємо.