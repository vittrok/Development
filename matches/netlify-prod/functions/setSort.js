import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL);
const ALLOWED = ['match','tournament','date','link','seen','color'];

export async function handler(event, context) {
  try {
    const body = JSON.parse(event.body || '{}');
    const column = body.column;
    const order = body.order;
    if (!ALLOWED.includes(column) || !['asc','desc'].includes(order)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid sort parameters' }) };
    }
    await sql`CREATE TABLE IF NOT EXISTS preferences ( sort_col TEXT, sort_order TEXT )`;
    await sql`DELETE FROM preferences`;
    await sql`INSERT INTO preferences (sort_col, sort_order) VALUES (${column}, ${order})`;
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("setSort error", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
