import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const store = getStore('match-store');

  try {
    const body = await req.json();
    await store.setJSON('match-state', body);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to save data', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
