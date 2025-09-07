# Архітектурна дельта 18.2 — Сесії (HMAC) та гігієна репозиторію

**Дата:** 2025-09-07  
**Статус:** застосовано

## 1) Сесійний cookie — єдине джерело істини

- Формат cookie: `session=<sid>.<sig>`, де  
  `sig = base64url( HMAC-SHA256(SESSION_SECRET, sid) )`.
- Перевірка підпису виконується **до** звернення в БД.
- Канонічна реалізація підпису/перевірки — у файлі:  
  `functions/_session.js` (`signSid`, `verifySigned`, `getSession`).
- Інші модулі (наприклад, `login.js`, `me.js`) **мають використовувати** API з `_session.js` і **не дублювати** власні `signSid/verifySid`.
- Атрибути cookie за замовчуванням:  
  `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30d`.
- Секрет `SESSION_SECRET` зберігається **лише** в env (Netlify). Значення **не комітиться**.

## 2) CORS / Origin

- Дозволений origin береться з `APP_ORIGIN` (env).
- Хардкоджених origin у функціях бути не повинно (поступово прибираємо).
- Для службових POST-ендпоїнтів дозволяємо лише наш прод-оригін.

## 3) Гігієна репозиторію

- Тимчасові локальні файли (`body.json`, `login.json`, `req.json`, `q.sql`, тощо) перенесено в `dev/fixtures/` і **заігнорено** в Git, окрім `dev/fixtures/README.md`.
- `cookies.txt` (cURL cookie jar) **заігнорено**; файл прибрано з індексу.
- Канонічне місце для схем/DDL — папка `sql/`. Дублікати у корені видаляємо після звірки.

## 4) Узгодженість із v1.1

- Публічний `GET /.netlify/functions/matches` — без «spoilers» (немає `home_score/away_score`), стабільне сортування, фільтри: `league`, `team`, `status`, `sort`.
- Імпорт/мердж: `import-to-staging` → `update-matches` → БД-функція `run_staging_validate_and_merge(...)` → оновлення `matches` з унікальністю (`date_bucket`, `pair_key`); логи в `sync_logs`.

## 5) Наступні мікрокроки (без зміни цієї дельти)

1. **Уніфікувати виклики**: перевести `login.js` (і за потреби `me.js`) на використання `signSid/verifySigned` з `_session.js` (прибрати дублювання).
2. **CORS/Origin**: замінити жорстко пришитий origin у службових функціях на `APP_ORIGIN` із `_utils`.
3. **Legacy-прибирання**: винести старі/неактуальні хендлери (наприклад, `getMatches.js`) у `legacy/` або видалити після звірки.
4. **Кодування коментарів**: пройтись по файлах із «кракозябрами» та зберегти як UTF-8 без BOM.

---
