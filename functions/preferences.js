// matches/netlify-prod/src/api/preferences.js
//
// Єдиний клієнт для налаштувань:
//  - getPreferences(): GET /.netlify/functions/preferences
//  - savePreferences(patch): POST /.netlify/functions/preferences (JSON)
// Примітки:
//  - Перед POST знімаємо CSRF через /me
//  - Кукі-сесія додається через credentials: 'include'
//  - Жодних паролів/секретів у коді (правило 13)

const FN_BASE = '/.netlify/functions';

async function getCsrf() {
  const res = await fetch(`${FN_BASE}/me`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      // Origin важливий для бек-перевірки
      'Origin': window.location.origin
    }
  });
  if (!res.ok) {
    throw new Error(`GET /me failed: ${res.status}`);
  }
  const j = await res.json();
  if (!j?.csrf) {
    throw new Error('No CSRF in /me (are you logged in?)');
  }
  return j.csrf;
}

export async function getPreferences() {
  const res = await fetch(`${FN_BASE}/preferences`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Origin': window.location.origin
    }
  });
  if (!res.ok) {
    throw new Error(`GET /preferences failed: ${res.status}`);
  }
  const j = await res.json();
  return j?.data ?? {};
}

export async function savePreferences(patch) {
  const csrf = await getCsrf();

  const res = await fetch(`${FN_BASE}/preferences`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Origin': window.location.origin,
      'Content-Type': 'application/json',
      'X-CSRF': csrf
    },
    body: JSON.stringify(patch || {})
  });

  if (res.status === 401) {
    const msg = await res.text();
    throw new Error(`Unauthorized: ${msg}`);
  }
  if (res.status === 403) {
    const msg = await res.text();
    throw new Error(`Forbidden (Origin): ${msg}`);
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST /preferences failed: ${res.status} ${txt}`);
  }

  const j = await res.json();
  return j?.data ?? {};
}
