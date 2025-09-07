# Архітектурна дельта 18.2 — Сесії та гігієна файлів

Дата: 2025-09-07

## 1) Сесійний cookie (єдине джерело істини)

- Формат cookie: `session=<sid>.<sig>`, де `sig = HMAC-SHA256(SESSION_SECRET, sid)` у base64url.
- Перевірка підпису виконується **до** звернення в БД.
- `SESSION_SECRET` зберігається лише в env (Netlify prod). Значення не комітимо.
- **Single source of truth:** реалізація підпису/перевірки зосереджена у `functions/_session.js`. Інші модулі (напр. `login.js`, `me.js`) використовують його API і не дублюють `signSid/verifySid`.
- Атрибути cookie за замовчуванням: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30d`.

## 2) CORS/Origin

- Допустимий origin читається з `APP_ORIGIN` (env). Хардкоджених origin бути не повинно.

## 3) Гігієна репозиторію

- Артефакти на кшталт `cookies.txt`, локальних payload-ів (`*.json` для cURL) і одноразових SQL-запитів зберігаються у `dev/fixtures/` і **ігноруються** Git.
- `schema.sql` зберігається канонічно в папці `sql/` (без дублю в корені).
