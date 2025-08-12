import { getStore } from '@netlify/blobs';

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // опціональна авторизація: якщо в Netlify зададеш ADMIN_SECRET, функція буде вимагати заголовок x-admin-secret
  const expectedSecret = process.env.ADMIN_SECRET;
  if (expectedSecret) {
    const provided = req.headers.get('x-admin-secret') || '';
    if (!provided || provided !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  }

  try {
    const body = await req.json();
    if (!Array.isArray(body)) {
      return new Response(JSON.stringify({ error: 'Expected an array of matches' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const store = getStore({ name: 'football-app', consistency: 'strong' });
    await store.setJSON('matches', body);
    console.log('Saved matches, count=', body.length);
    return new Response(JSON.stringify({ success: true, count: body.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('saveMatches error', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
