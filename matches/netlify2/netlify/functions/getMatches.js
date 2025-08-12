import { getStore } from '@netlify/blobs';

export default async function handler(req, context) {
  try {
    const store = getStore({ name: 'football-app', consistency: 'strong' });
    const data = await store.get('matches', { type: 'json' });
    // повертаємо масив (або пустий масив)
    return new Response(JSON.stringify(Array.isArray(data) ? data : []), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('getMatches error', err);
    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
  }
}
