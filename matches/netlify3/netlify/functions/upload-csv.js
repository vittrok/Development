import { parse } from 'csv-parse/sync';
import { neon } from '@netlify/neon';

const sql = neon();

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { csv } = JSON.parse(event.body); // отримуємо CSV як текст

    // Парсимо CSV
    const records = parse(csv, {
      columns: ['id', 'match', 'tournament', 'date', 'link'],
      skip_empty_lines: true,
      from_line: 2 // пропускаємо заголовок
    });

    // Вставляємо кожен матч у базу (upsert за id)
    for (const row of records) {
      const { id, match, tournament, date, link } = row;

      await sql`
        INSERT INTO matches (id, match, tournament, date, link)
        VALUES (${id}, ${match}, ${tournament}, ${date}, ${link})
        ON CONFLICT (id) DO UPDATE SET
          match = EXCLUDED.match,
          tournament = EXCLUDED.tournament,
          date = EXCLUDED.date,
          link = EXCLUDED.link;
      `;
    }

    return { statusCode: 200, body: JSON.stringify({ message: 'CSV uploaded and processed' }) };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
}