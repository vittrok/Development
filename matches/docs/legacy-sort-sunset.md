> Офіційне “sunset” для legacy-ендпоінтів.
# Legacy sort endpoints — Sunset

**Ендпоінти:**
- `/getSort`
- `/setSort`
- `/setSeenColor`

**Статус:** `410 Gone` (заморожені)  
**Заміна:** `/preferences` (GET/POST)

## Міграція клієнта
- Читання префів: `GET /.netlify/functions/preferences`
- Запис префів: `POST /.netlify/functions/preferences` з `X-CSRF`

### Приклад (JS, fetch)
```js
const res = await fetch('/.netlify/functions/preferences', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF': window.__csrf, // значення з /me
  },
  credentials: 'include',
  body: JSON.stringify({ sort_col: 'league', sort_order: 'asc' }),
});
const json = await res.json();
