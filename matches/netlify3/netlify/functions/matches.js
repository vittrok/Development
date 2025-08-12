import { neon } from '@netlify/neon';
const sql = neon();

export async function handler(event) {
  const method = event.httpMethod;

  if (method === 'GET') {
    // Повертаємо всі матчі
    const matches = await sql`SELECT * FROM matches ORDER BY date DESC`;
    return { statusCode: 200, body: JSON.stringify(matches) };
  }

  if (method === 'PATCH') {
    // Оновлення поля viewed
    try {
      const { id, viewed } = JSON.parse(event.body);
      if (typeof id === 'undefined' || typeof viewed === 'undefined') {
        return { statusCode: 400, body: 'Missing id or viewed' };
      }

      await sql`UPDATE matches SET viewed = ${viewed} WHERE id = ${id}`;
      return { statusCode: 200, body: JSON.stringify({ message: 'Updated' }) };
    } catch (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
}