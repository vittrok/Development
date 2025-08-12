import { neon } from '@netlify/neon';
const sql = neon();

export async function handler(event) {
  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { id } = JSON.parse(event.body);
    if (!id) return { statusCode: 400, body: 'Missing id' };

    await sql`DELETE FROM matches WHERE id = ${id}`;
    return { statusCode: 200, body: JSON.stringify({ message: 'Deleted' }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
}