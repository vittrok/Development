import { getStore } from '@netlify/blobs';

export default async function handler(req, context) {
  try {
    const store = getStore({ name: 'football-app', consistency: 'strong' });
    const data = await store.get('state', { type: 'json' });
    // default state
    const def = { seen: {}, selectedColor: '#ffe4e1', sortBy: 'id', sortDir: 'asc' };
    return new Response(JSON.stringify(Object.assign({}, def, data || {})), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('loadState error', err);
    return new Response(JSON.stringify({ seen: {}, selectedColor: '#ffe4e1', sortBy: 'id', sortDir: 'asc' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
