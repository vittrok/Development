import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const store = getStore('match-store');

  try {
    const data = await store.get('match-state', { type: 'json' });
    return new Response(JSON.stringify(data || {}), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to load data', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
