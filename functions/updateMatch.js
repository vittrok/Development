import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL);

export async function handler(event, context) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { date, match, seen, color } = body;
    if (!date || !match) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing date or match' }) };
    }
    await sql`UPDATE matches SET seen = ${!!seen}, color = ${color || 'lightyellow'} WHERE date = ${date} AND match = ${match}`;
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("updateMatch error", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
