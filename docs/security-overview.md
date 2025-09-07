# Security Overview (Auth, CSRF, CORS, Tokens)

**Версія:** 18.2  
**Останнє оновлення:** 2025-09-07  
**Скоуп:** Netlify Functions (prod), Postgres/Neon, публічний GET для матчів.

---

## 1) Цілі безпеки

- Публічний каталог матчів **без спойлерів** (жодних score-полів).
- Захист адмін-операцій: import to staging та merge до канону — **лише з токеном**.
- Браузерні виклики: контрольовані CORS + CSRF для state-changing сесійних дій.
- Секрети зберігаються **лише** в Netlify env.

---

## 2) Матриця ендпоїнтів та авторизації

| Ендпоїнт                                      | Метод | Хто може                                  | Захист                                                    |
|-----------------------------------------------|-------|-------------------------------------------|-----------------------------------------------------------|
| `/.netlify/functions/matches`                 | GET   | публічно                                  | CORS (read), **без score**                                |
| `/.netlify/functions/import-to-staging`       | POST  | технічна інтеграція / оператор             | **Authorization: Bearer `<UPDATE_TOKEN>`**; CORS allowlist |
| `/.netlify/functions/update-matches`          | POST  | оператор                                  | **Authorization: Bearer `<UPDATE_TOKEN>`**; CORS allowlist |
| `/.netlify/functions/login` → `/.netlify/functions/me` → `/.netlify/functions/logout` | POST/GET/POST | оператор (браузер) | HttpOnly cookie (sid.sig), **CSRF** на state-changing, CORS allowlist |

> Примітка: `/import-to-staging` вимагає той самий `UPDATE_TOKEN`, що й `/update-matches`. Це зафіксовано як **прод-реальність** і синхронізовано з документацією.

---

## 3) Сесії та cookie

- Формат cookie: `session=sid.sig` (HMAC підпис через `SESSION_SECRET`).
- Атрибути: `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age≈30d`.
- Revocation/expiry: БД-таблиця `sessions` (`revoked=false`, `expires_at>NOW()`).
- `getSession(event)` повертає `{role, sid}` або `null`.

---

## 4) CSRF (браузерні сесії)

- `GET /me` повертає `{"csrf":"<csrf-token>"}` лише для автентифікованої сесії.
- Будь-яка state-changing операція (напр. `POST /logout`) вимагає заголовок `X-CSRF: <token>` з `/me`.
- Додаткові заголовки: `X-Requested-With: XMLHttpRequest`, `Content-Type: application/json`.

---

## 5) Токен адмін-операцій (`UPDATE_TOKEN`)

- Довгий секрет (Base64URL або hex), зберігається тільки в **Netlify env** (Production).
- Передається як **`Authorization: Bearer <UPDATE_TOKEN>`**.
- Ротація: генерувати новий → оновити env → **redeploy** → відкликати старий. **Не комітити.**

---

## 6) CORS

- Дозволений оригін: `APP_ORIGIN` (env).  
- Preflight (`OPTIONS`) відповідає:  
  - `Access-Control-Allow-Origin: <APP_ORIGIN>`  
  - `Access-Control-Allow-Methods: GET,POST,OPTIONS` (залежно від ендпоїнту)  
  - `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CSRF`  
  - `Access-Control-Allow-Credentials: true`
- Нема “дзеркалення” довільних Origin — лише дозволений.

---

## 7) Потоки даних

1. **Імпорт:** клієнт надсилає у `import-to-staging` (масив / `{matches:[…]}`; JSON або base64) **з Bearer-токеном**.  
2. **Валідація/канонізація:** staging перевірки, нормалізація полів, єдиний `import_batch_id` на виклик.  
3. **Merge:** `update-matches` (Bearer) викликає БД-функцію `run_staging_validate_and_merge(...)`.  
4. **Публікація:** нові записи стають видимі в публічному `GET /matches` (без score-полів).

---

## 8) Логування та аудит

- `sync_logs`: всі merge/cron виклики з таймстемпами, `trigger_type`, `source`, `import_batch_id`, `stats`.  
- Рекомендація: періодичний аудит `sync_logs` і контроль дублікатів у `matches` за `(date_bucket, pair_key)`.

---

## 9) Траблшутінг (швидко)

- **401 Unauthorized:** відсутній або неправильний Bearer токен; перевірити Production env та зробити redeploy.  
- **400 Invalid JSON body (Windows):** для `curl.exe` використовуйте `--data-binary` із файлу без BOM; або `Invoke-RestMethod`.  
- **500 помилки схеми:** функція підлаштовується під наявні колонки (`venue`/`metadata` додаються, лише якщо існують). Якщо все одно 500 — перевірити актуальність таблиці `staging_matches` і параметри виклику.
