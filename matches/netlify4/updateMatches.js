import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',').map(s => s.trim());
  return lines.map(line => {
    const cols = line.split(',').map(s => s.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = cols[i] || '');
    return obj;
  });
}

async function main() {
  const sql = neon(process.env.DATABASE_URL);

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

  const prefs = await sql`SELECT 1 FROM preferences LIMIT 1`;
  if (!prefs.length) {
    await sql`INSERT INTO preferences (sort_col, sort_order) VALUES ('date', 'asc')`;
  }

  const csvPath = path.join(process.cwd(), 'data', 'matches.csv');
  const csv = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(csv);

  for (const r of rows) {
    await sql`
      INSERT INTO matches (date, match, tournament, link)
      VALUES (${r.date}, ${r.match}, ${r.tournament}, ${r.link})
      ON CONFLICT (date, match) DO UPDATE
      SET tournament = EXCLUDED.tournament, link = EXCLUDED.link
    `;
  }

  console.log(`Upserted ${rows.length} rows.`);
}

main().catch(e => { console.error(e); process.exit(1); });
