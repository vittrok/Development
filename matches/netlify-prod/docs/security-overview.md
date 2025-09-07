# Security Overview (Auth, CSRF, CORS, Tokens)

**Версія:** 18.x  
**Останнє оновлення:** 2025-09-07  
**Скоуп:** Netlify Functions (prod), Postgres/Neon, публічний GET для матчів.

---

## 1) Цілі безпеки

- Публічний каталог матчів **без спойлерів** (жодних score-полів).
- Захист адмін-операцій: merge зі staging → matches лише за наявності токена.
- Браузерні виклики: контрольовані CORS + CSRF для state-changing сесійних дій.
- Секрети зберігаються **лише** в Netlify env.

---

## 2) Матриця ендпоїнтів та авторизації

| Ендпоїнт                                      | Метод | Хто може | Захист                                         |
|-----------------------------------------------|-------|---------|-----------------------------------------------|
| `/.netlify/functions/matches`                 | GET   | публічно| CORS (read), **без score**                    |
| `/.netlify/functions/import-to-staging`       | POST  | технічна інтеграція / оператор | CORS allowlist; тіло JSON або base64; **без токена**; валідація/канонізація ідемпотентного імпорту |
| `/.netlify/functions/update-matches`          | POST  | оператор| **UPDATE_TOKEN** (Bearer або `X-Update-Token`); CORS allowlist |
| `/.netlify/functions/login` → `/.netlify/functions/me` → `/.netlify/functions/logout` | POST/GET/POST | оператор (браузер) | HttpOnly cookie (sid.sig), **CSRF** на state-changing, CORS allowlist |

> Примітка: `import-to-staging` не має токена — це **свідомий дизайн** для простоти інтеграцій, при цьому обмежений CORS-оригіном і внутрішньою валідацією/канонізацією, а фактична публікація даних відбувається лише через захищений merge.

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
- Передається як `Authorization: Bearer <UPDATE_TOKEN>` або `X-Update-Token: <UPDATE_TOKEN>`.
- Ротація: генерувати новий → оновити env → redeploy → відкликати старий. **Не комітити.**

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

1. **Імпорт:** клієнт надсилає у `import-to-staging` (масив / `{matches:[…]}` / один об’єкт; JSON або base64).  
2. **Валідація/канонізація:** staging перевірки, нормалізація полів.  
3. **Merge:** `update-matches` (тільки з токеном) викликає БД-функцію `run_staging_validate_and_merge(...)`.  
4. **Публікація:** нові записи стають видимі в публічному `GET /matches` (без score-полів).

---

## 8) Логування та аудит

- `sync_logs`: всі merge/cron виклики з таймстемпами, `trigger_type`, `source`, `import_batch_id`, `stats`.  
- Рекомендація: періодичний аудит `sync_logs` і контроль дублікатів у `matches` за `(date_bucket, pair_key)`.

---

## 9) Траблшутінг (швидко)

- **400 Invalid JSON body:** перевірити `Content-Type`, використовувати `--data-binary`, уникати BOM; fallback — base64 (`text/plain`).  
- **401 Unauthorized (update-matches):** перевірити токен і `APP_ORIGIN`; redeploy після зміни env.  
- **CSRF/403 на logout:** бракує `X-CSRF`/`X-Requested-With`/`Content-Type`.  
- **Дані не з’являються в GET:** дивитися `staging_matches` + `sync_logs` + унікальність `(date_bucket, pair_key)`.

---

## 10) Інструменти перевірки

- `dev/ops-auth-smoke.ps1` — швидкий smoke CORS/Token/CSRF (Windows PowerShell 5.x).  
- `docs/admin-ops.md` — покрокові інструкції з імпорту/merge + SQL-перевірки.

---

## 11) Чек-ліст перед змінами

- [ ] Токени/паролі лише в Netlify env.  
- [ ] `APP_ORIGIN` узгоджений із фронтом.  
- [ ] Жодних `score` у публічному API.  
- [ ] Smoke (`dev/ops-auth-smoke.ps1`) зелений на проді.  
- [ ] Аудит `sync_logs` без аномалій.

