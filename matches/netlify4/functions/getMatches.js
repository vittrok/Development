import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL);

export async function handler(event, context) {
  try {
    // ensure tables exist
    await sql`CREATE TABLE IF NOT EXISTS matches (
      date DATE,
      match TEXT,
      tournament TEXT,
      link TEXT,
      seen BOOLEAN DEFAULT FALSE,
      color TEXT DEFAULT 'lightyellow',
      UNIQUE (date, match)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS preferences (
      sort_col TEXT,
      sort_order TEXT
    )`;

    // read sort preference
    const prefs = await sql`SELECT sort_col, sort_order FROM preferences LIMIT 1`;
    let sortCol = 'date', sortOrder = 'asc';
    const allowedCols = ['match','tournament','date','link','seen','color'];
    if (prefs.length) {
      const c = prefs[0].sort_col;
      const o = prefs[0].sort_order;
      if (allowedCols.includes(c)) sortCol = c;
      if (o === 'desc') sortOrder = 'desc';
    }

    // dynamic order by (validated)
    const rows = await sql(`SELECT match, tournament, date, link, seen, color FROM matches ORDER BY ${sortCol} ${sortOrder}`);
    const matches = rows.map(r => ({
      match: r.match,
      tournament: r.tournament,
      date: r.date instanceof Date ? r.date.toISOString().slice(0,10) : r.date,
      link: r.link,
      seen: r.seen,
      color: r.color
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ matches, sort: { column: sortCol, order: sortOrder } })
    };
  } catch (err) {
    console.error("getMatches error", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
