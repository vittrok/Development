import { getStore } from '@netlify/blobs';

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    // body має містити { seen:{...}, selectedColor: '#hex', sortBy, sortDir }
    const store = getStore({ name: 'football-app', consistency: 'strong' });
    await store.setJSON('state', body);
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('saveState error', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
