# Admin Operations (staging → merge) — інструкції

**Версія:** 18.1
**Останнє оновлення:** 2025-09-07
**Аудиторія:** оператори/адміни проєкту
**Мета:** безпечний імпорт у `staging`, ручний/плановий merge у `matches`, перевірки та траблшутінг — **без змін у коді**.

---

## 0) Політики та рамки

* **Гілка/деплой:** пуші **лише** в `main` → production. Рухаємося дрібними кроками, не ламаємо наявні дані.
* **Без “spoilers”:** публічний `GET /matches` **не містить** полів рахунку (`home_score/away_score`).
* **CORS:** дозволений origin задається `APP_ORIGIN` (env).
* **Секрети:** усі токени/паролі — **тільки** в Netlify env. Не комітити у репозиторій.
* **Канон БД:** унікальність `matches` за `(date_bucket, pair_key)`; шлях: `staging_matches` → валідація/канонізація → ідемпотентний merge → логи в `sync_logs`.

---

## 1) Секрети / ENV

### 1.1. `UPDATE_TOKEN` — довгий секрет для ручних оновлень

Використовується у `POST /.netlify/functions/update-matches`.

**Згенерувати в PowerShell (Base64URL, 48 байт ≈ 384 біт):**

```powershell
$b = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$b64 = [Convert]::ToBase64String($b)
# URL-safe без '='
($b64.TrimEnd('=')) -replace '\+','-' -replace '/','_'
```

**Альтернатива (Hex, 32 байти ≈ 256 біт):**

```powershell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
($b | ForEach-Object ToString X2) -join ''
```

**Додати у Netlify → Site settings → Environment variables:**

* Name: `UPDATE_TOKEN`
* Value: (згенерований рядок)
* Scope: **Production** (включно з Functions)
* Далі: **Redeploy** (краще “Clear cache and deploy”).

> **Ротація:** створити нове значення → оновити env → redeploy → відкликати старе. **Ніколи не комітити**.

### 1.2. Інші важливі ENV (нагадування)

* `APP_ORIGIN` — прод-оригін (для CORS).
* `SESSION_SECRET` — 32 байти Base64URL для HMAC-cookie.
* `DATABASE_URL` — доступ до Neon/Postgres.

---

## 2) Ендпоїнти

* **Публічний GET:**
  `GET /.netlify/functions/matches`
  Фільтри: `league`, `team`, `status`, `sort` (`kickoff_asc|kickoff_desc`). **Без полів рахунку.**

* **Імпорт у staging:**
  `POST /.netlify/functions/import-to-staging`
  Тіло: **масив** матчів, **або** `{ "matches": [...] }`, **або** **один** матч-об’єкт.
  `import_batch_id`: можна **не** вказувати; можна вказати (UUID або текст).
  **Без токена.** Тіло — JSON (UTF-8 **без BOM**) або **base64** (fallback).

* **Merge з staging у matches:**
  `POST /.netlify/functions/update-matches`
  Тіло: `{ "trigger_type": "manual"|"cron", "source": "…", "import_batch_id": "…" }`
  **Потрібен** `UPDATE_TOKEN`. Працює й без `import_batch_id` (загальний merge).

* **Плановий апдейт:** Netlify Scheduled Function викликає `update-matches` з `trigger_type=cron`.

---

## 3) Виклики (PowerShell-first; робастні приклади)

> Базовий префікс:
>
> ```powershell
> $FN = "https://football-m.netlify.app/.netlify/functions"
> ```

### 3.1. `POST /import-to-staging`

**A) Масив матчів:**

```powershell
$json = @'
[
  {
    "league": "EPL",
    "home_team": "Arsenal",
    "away_team": "Chelsea",
    "kickoff_at": "2025-09-14T13:30:00Z",
    "status": "scheduled",
    "metadata": { "source_id": "api-x-123" }
  }
]
'@

Invoke-WebRequest -Uri "$FN/import-to-staging" -Method POST `
  -ContentType "application/json; charset=utf-8" -Body $json
```

**B) Обгортка `{ matches: [...] }`:**

```powershell
$json = @'
{
  "matches": [
    {
      "league": "EPL",
      "home_team": "Manchester City",
      "away_team": "Arsenal",
      "kickoff_at": "2025-09-21T15:30:00Z",
      "status": "scheduled",
      "metadata": { "batch": "manual-sept" }
    }
  ]
}
'@

Invoke-WebRequest -Uri "$FN/import-to-staging" -Method POST `
  -ContentType "application/json; charset=utf-8" -Body $json
```

**C) Один матч-об’єкт:**

```powershell
$json = @'
{
  "league": "LaLiga",
  "home_team": "Barcelona",
  "away_team": "Real Madrid",
  "kickoff_at": "2025-10-26T19:00:00Z",
  "status": "scheduled"
}
'@

Invoke-WebRequest -Uri "$FN/import-to-staging" -Method POST `
  -ContentType "application/json; charset=utf-8" -Body $json
```

**D) `import_batch_id` (UUID і текст):**

```powershell
# UUID
$uuid = [guid]::NewGuid().ToString()
$json = @"
{ "matches":[ { "league":"UEFA","home_team":"Dinamo","away_team":"Feyenoord","kickoff_at":"2025-10-01T18:00:00Z","status":"scheduled" } ],
  "import_batch_id":"$uuid" }
"@
Invoke-WebRequest -Uri "$FN/import-to-staging" -Method POST `
  -ContentType "application/json; charset=utf-8" -Body $json

# Текстовий ідентифікатор
$json = @'
{
  "matches":[
    { "league":"International","home_team":"Italy","away_team":"Germany","kickoff_at":"2025-03-21T00:00:00Z","status":"finished" }
  ],
  "import_batch_id":"friendly-2025-03-21"
}
'@
Invoke-WebRequest -Uri "$FN/import-to-staging" -Method POST `
  -ContentType "application/json; charset=utf-8" -Body $json
```

**E) Якщо клієнт ламає JSON (BOM/CRLF) — відправити base64:**

```powershell
$raw = '{"matches":[{"league":"EPL","home_team":"Liverpool","away_team":"Everton","kickoff_at":"2025-09-28T13:00:00Z","status":"scheduled"}]}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw))

Invoke-WebRequest -Uri "$FN/import-to-staging" -Method POST `
  -ContentType "text/plain; charset=utf-8" -Body $b64
```

> Підтримуються: **масив**, **обгортка**, **один об’єкт**, **JSON або base64**.

---

### 3.2. `POST /update-matches` (merge з staging)

**Токен:** використовуй **один** варіант (обидва працюють):

* `Authorization: Bearer <UPDATE_TOKEN>`
* `X-Update-Token: <UPDATE_TOKEN>`

> Порада: підготуй `$origin` раз (сумісно з Windows PowerShell 5.x):
>
> ```powershell
> $origin = if ($env:APP_ORIGIN) { $env:APP_ORIGIN } else { "https://football-m.netlify.app" }
> ```

**Ручний merge (конкретний batch або загальний):**

```powershell
$TOKEN = "<UPDATE_TOKEN>"
$origin = if ($env:APP_ORIGIN) { $env:APP_ORIGIN } else { "https://football-m.netlify.app" }

$headers = @{
  "Authorization"    = "Bearer $TOKEN"
  "Content-Type"     = "application/json"
  "Origin"           = $origin
  "X-Requested-With" = "XMLHttpRequest"
}

# 1) Merge конкретного batch:
$bodySpecific = '{ "trigger_type":"manual", "source":"ops", "import_batch_id":"<uuid-or-text>" }'
Invoke-WebRequest -Uri "$FN/update-matches" -Method POST -Headers $headers -Body $bodySpecific

# 2) Загальний merge (без batch):
$bodyGeneral  = '{ "trigger_type":"manual", "source":"ops" }'
Invoke-WebRequest -Uri "$FN/update-matches" -Method POST -Headers $headers -Body $bodyGeneral
```

**Cron-подібний ручний тест:**

```powershell
$TOKEN = "<UPDATE_TOKEN>"
$origin = if ($env:APP_ORIGIN) { $env:APP_ORIGIN } else { "https://football-m.netlify.app" }

$headers = @{
  "Authorization"    = "Bearer $TOKEN"
  "Content-Type"     = "application/json"
  "Origin"           = $origin
  "X-Requested-With" = "XMLHttpRequest"
}
$body = '{ "trigger_type":"cron", "source":"ops-test" }'
Invoke-WebRequest -Uri "$FN/update-matches" -Method POST -Headers $headers -Body $body
```

**`curl.exe` (Windows) без BOM — приклади:**

```powershell
# Масив матчів
curl.exe -sS -X POST "$FN/import-to-staging" `
  -H "Content-Type: application/json" `
  --data-binary "[{""league"":""EPL"",""home_team"":""Arsenal"",""away_team"":""Chelsea"",""kickoff_at"":""2025-09-14T13:30:00Z"",""status"":""scheduled""}]"

# Ручний merge (Authorization Bearer)
curl.exe -sS -X POST "$FN/update-matches" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer %UPDATE_TOKEN%" `
  --data-binary "{\"trigger_type\":\"manual\",\"source\":\"ops\"}"
```

> У **PowerShell** перенос — бектик `` ` ``; у **cmd.exe** — `^`.

---

## 4) Перевірки

### 4.1. Публічний `GET /matches`

```powershell
# Усі (дефолт: sort=kickoff_desc)
curl.exe -sS "$FN/matches" | more

# Фільтри
curl.exe -sS "$FN/matches?league=EPL"
curl.exe -sS "$FN/matches?team=Arsenal"
curl.exe -sS "$FN/matches?status=scheduled"
curl.exe -sS "$FN/matches?sort=kickoff_asc"
curl.exe -sS "$FN/matches?league=EPL&team=Arsenal&status=scheduled&sort=kickoff_asc"
```

**Очікування:** `200 OK`, стабільне сортування, **жодних** полів рахунку, нові матчі присутні.

### 4.2. SQL у Neon (детальна валідація)

```sql
-- Останні записи в staging
SELECT id, import_batch_id, league, home_team, away_team, kickoff_at, status, created_at
FROM staging_matches
ORDER BY created_at DESC
LIMIT 50;

-- Групування за import_batch_id
SELECT import_batch_id, COUNT(*) AS num
FROM staging_matches
GROUP BY import_batch_id
ORDER BY num DESC, import_batch_id DESC;

-- Логи merge/cron
SELECT id, created_at, trigger_type, source, import_batch_id, stats
FROM sync_logs
ORDER BY created_at DESC
LIMIT 50;

-- Перевірка унікальності канону (очікуємо відсутність дублікатів)
SELECT date_bucket, pair_key, COUNT(*) AS num
FROM matches
GROUP BY date_bucket, pair_key
HAVING COUNT(*) > 1;
```

---

## 5) Траблшутінг

### 5.1. `Invalid JSON body`

* **Content-Type:** `application/json; charset=utf-8`.
* Використовуй `--data-binary` (curl) або `-Body` (Invoke-WebRequest) — **без BOM**.
* Якщо клієнт додає BOM/CRLF/зламане кодування — надсилай **base64** як `text/plain` (див. §3.1-E).
* У Windows: в **PowerShell** перенос — **бектик** `` ` ``, не `^`.

### 5.2. `401 Unauthorized` (на `update-matches`)

* Передай `Authorization: Bearer <UPDATE_TOKEN>` (або `X-Update-Token`).
* Перевір `UPDATE_TOKEN` у Netlify env (Production) + redeploy.
* Для браузера — `Origin` має дорівнювати `APP_ORIGIN`.

### 5.3. `UUID vs text` у `import_batch_id`

* Підтримуються **обидва** формати (UUID v4 **або** текст).
* Якщо не задано — відслідковуй merge за `sync_logs`.

### 5.4. Матчі не з’являються у `GET /matches`

* Перевір, що імпорт дійшов у `staging_matches`.
* Переглянь `sync_logs` — чи виконувався merge і які `stats`.
* Переконайся, що унікальність `(date_bucket, pair_key)` не блокує операцію.

---

## 6) Нотатки безпеки

* **Не комітити**: токени, cookie-jar, тимчасові JSON/SQL-файли.
* **Ротація**: новий токен → оновити env → redeploy → негайно вивести з обігу старий.
* **CORS/Origin**: приймаємо POST-операції лише з `APP_ORIGIN`.
* **Деплой**: пуші лише в `main`.

---

## 7) Критерії приймання

* Файл `docs/admin-ops.md` створений у репозиторії (`main`), повністю заповнений.
* Приклади команд (PowerShell/`curl.exe`) працюють на проді.
* Перевірки (`GET /matches`, SQL у Neon) дають очікувані результати.
* У цьому кроці **немає** змін у коді чи схемі.

---

## 8) Додаток: швидкий чек-ліст

**Перед операцією:**

* [ ] `UPDATE_TOKEN` у Netlify env (Production).
* [ ] `APP_ORIGIN` відповідає прод-домену.
* [ ] Доступ до Neon для read-only перевірок.

**Операція:**

* [ ] `POST /import-to-staging` (масив/обгортка/один об’єкт; за потреби — base64).
* [ ] `POST /update-matches` з `Authorization: Bearer <UPDATE_TOKEN>`.

**Після:**

* [ ] `GET /matches` відображає очікувані зміни (без score-полів).
* [ ] SQL-перевірки в `staging_matches`, `sync_logs`.
* [ ] Відсутні дублікати `(date_bucket, pair_key)` у `matches`.

---

## 9) Smoke-скрипт для перевірки безпеки

У репозиторії є скрипт **`dev/ops-auth-smoke.ps1`** (Windows PowerShell 5.x), що виконує швидку перевірку CORS/токена та (опційно) цикл `login → me → logout`.

**Запуск (рекомендовано):**

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\dev\ops-auth-smoke.ps1 `
  -FunctionsBase "https://football-m.netlify.app/.netlify/functions" `
  -Origin "https://football-m.netlify.app" `
  -UpdateToken "<UPDATE_TOKEN>"
```

> Якщо не хочеш передавати токен у команді:
>
> ```powershell
> $env:UPDATE_TOKEN = "<UPDATE_TOKEN>"
> powershell.exe -ExecutionPolicy Bypass -NoProfile -File .\dev\ops-auth-smoke.ps1 `
>   -FunctionsBase "https://football-m.netlify.app/.netlify/functions" `
>   -Origin "https://football-m.netlify.app"
> ```

**Очікування:** у фіналі скрипт друкує `ALL CHECKS PASSED`.
Опціонально додай у корінь `login.json` із валідними кредами:

```json
{"username":"...", "password":"..."}
```

тоді скрипт додатково перевірить `login/me/logout`.
