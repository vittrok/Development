Admin Operations (staging → merge) — інструкції

Версія: 18.1
Останнє оновлення: 2025-09-07
Аудиторія: оператори/адміни проєкту
Ціль: безпечний імпорт у staging, ручний/плановий merge у matches, перевірки та траблшутінг — без змін у коді.

0) Політики та передумови

Гілка/деплой: пуші лише в main → production. Не ламаємо наявні дані.

Без “spoilers”: публічний GET /matches не містить home_score/away_score.

CORS: дозволений origin задається APP_ORIGIN (env).

Секрети: токени/паролі — лише в Netlify env. Не комітити в репо.

БД-канон: унікальність matches за (date_bucket, pair_key).
staging_matches → валідація/канонізація → ідемпотентний merge → логи в sync_logs.

Процес: дрібні кроки → кожен крок валідуємо.

1) Секрети / ENV
1.1. UPDATE_TOKEN (довгий секрет для ручних оновлень)

Використовується у POST /.netlify/functions/update-matches.

Згенерувати в PowerShell (Base64URL, 48 байт ≈ 384 біт):

$b = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$b64 = [Convert]::ToBase64String($b)
# URL-safe без '='
($b64.TrimEnd('=')) -replace '\+','-' -replace '/','_'


Альтернатива (Hex, 32 байти ≈ 256 біт):

$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
($b | ForEach-Object ToString X2) -join ''


Додати у Netlify → Site settings → Environment variables:

Name: UPDATE_TOKEN

Value: (згенерований рядок)

Scope: Production (включно з Functions)

Далі: Redeploy (краще “Clear cache and deploy”).

Ротація: створити нове значення → оновити env → redeploy → відкликати старе.

1.2. Інші важливі ENV (нагадування)

APP_ORIGIN — продовий оригін (для CORS).

SESSION_SECRET — 32 байти Base64URL, для HMAC-cookie (вже налаштовано).

DATABASE_URL — доступ до Neon/Postgres.

2) Ендпоїнти

Публічний GET:
GET /.netlify/functions/matches
Фільтри: league, team, status, sort (kickoff_asc|kickoff_desc). Без полів рахунку.

Імпорт у staging:
POST /.netlify/functions/import-to-staging
Тіло: масив матчів, або { "matches": [...] }, або один матч-об’єкт.
import_batch_id: можна не вказувати; можна вказати (UUID або текст).
Без токена. Тіло — JSON (UTF-8 без BOM) або base64 (fallback).

Merge з staging у matches:
POST /.netlify/functions/update-matches
Тіло: { "trigger_type": "manual"|"cron", "source": "…", "import_batch_id": "…" }
Потрібен UPDATE_TOKEN (див. 3.2). Працює й без import_batch_id (загальний merge).

Планове оновлення (cron): Netlify Scheduled Function викликає update-matches із trigger_type=cron.

3) Виклики (PowerShell-first; робастні варіанти)

У прикладах використовуємо базовий префікс функцій:

$FN = "https://football-m.netlify.app/.netlify/functions"

3.1. POST /import-to-staging

A. Масив матчів:

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


B. Обгортка { matches: [...] }:

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


C. Один матч-об’єкт:

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


D. Передача import_batch_id (UUID і текст):

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


E. Якщо клієнт ламає JSON (BOM/CRLF) — надсилаємо base64:

$raw = '{"matches":[{"league":"EPL","home_team":"Liverpool","away_team":"Everton","kickoff_at":"2025-09-28T13:00:00Z","status":"scheduled"}]}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw))

Invoke-WebRequest -Uri "$FN/import-to-staging" -Method POST `
  -ContentType "text/plain; charset=utf-8" -Body $b64


Сервер підтримує: масив, обгортку, один об’єкт, JSON або base64.

3.2. POST /update-matches (merge з staging)

Токен: використай один із варіантів (обидва приймаються):

Authorization: Bearer <UPDATE_TOKEN>

X-Update-Token: <UPDATE_TOKEN>

Ручний merge (конкретний batch або загальний):

$TOKEN = "<UPDATE_TOKEN>"
$headers = @{
  "Authorization"    = "Bearer $TOKEN"
  "Content-Type"     = "application/json"
  "Origin"           = ($env:APP_ORIGIN ?? "https://football-m.netlify.app")
  "X-Requested-With" = "XMLHttpRequest"
}

# Приклади тіл:
$bodySpecific = '{ "trigger_type":"manual", "source":"ops", "import_batch_id":"<uuid-or-text>" }'
$bodyGeneral  = '{ "trigger_type":"manual", "source":"ops" }'  # без batch → загальний merge

Invoke-WebRequest -Uri "$FN/update-matches" -Method POST -Headers $headers -Body $bodySpecific
Invoke-WebRequest -Uri "$FN/update-matches" -Method POST -Headers $headers -Body $bodyGeneral


Cron-подібний виклик (для тесту):

$headers = @{
  "Authorization"    = "Bearer $TOKEN"
  "Content-Type"     = "application/json"
  "Origin"           = "https://football-m.netlify.app"
  "X-Requested-With" = "XMLHttpRequest"
}
$body = '{ "trigger_type":"cron", "source":"ops-test" }'
Invoke-WebRequest -Uri "$FN/update-matches" -Method POST -Headers $headers -Body $body

4) Перевірки
4.1. Публічний GET /matches
$FN = "https://football-m.netlify.app/.netlify/functions"

# Усі (за замовчуванням sort=kickoff_desc)
curl.exe -sS "$FN/matches" | more

# Фільтри
curl.exe -sS "$FN/matches?league=EPL"
curl.exe -sS "$FN/matches?team=Arsenal"
curl.exe -sS "$FN/matches?status=scheduled"
curl.exe -sS "$FN/matches?sort=kickoff_asc"
curl.exe -sS "$FN/matches?league=EPL&team=Arsenal&status=scheduled&sort=kickoff_asc"


Очікування: 200 OK, стабільне сортування, жодних полів рахунку, нові матчі присутні.

4.2. SQL у Neon

Staging — останні імпорти:

SELECT id, import_batch_id, league, home_team, away_team, kickoff_at, status, created_at
FROM staging_matches
ORDER BY created_at DESC
LIMIT 50;


Групування за batch:

SELECT import_batch_id, COUNT(*) AS num
FROM staging_matches
GROUP BY import_batch_id
ORDER BY num DESC, import_batch_id DESC;


Логи merge/cron:

SELECT id, created_at, trigger_type, source, import_batch_id, stats
FROM sync_logs
ORDER BY created_at DESC
LIMIT 50;


Унікальність канону:

SELECT date_bucket, pair_key, COUNT(*) AS num
FROM matches
GROUP BY date_bucket, pair_key
HAVING COUNT(*) > 1;


Перевірка появи конкретного матчу:

SELECT id, league, home_team, away_team, kickoff_at, status, created_at
FROM matches
WHERE league='EPL' AND home_team='Arsenal' AND away_team='Chelsea'
ORDER BY kickoff_at DESC
LIMIT 5;

5) Траблшутінг
5.1. Invalid JSON body

Content-Type: application/json; charset=utf-8.

Відправляти --data-binary або Invoke-WebRequest -Body $json (без BOM).

Якщо клієнт додає BOM/CRLF/невалідне кодування — відправити base64 як text/plain.

У Windows: в PowerShell перенос — бектик `, не ^ (останній — для cmd.exe).

5.2. 401 Unauthorized (на update-matches)

Перевір, що передано Authorization: Bearer <UPDATE_TOKEN> (або X-Update-Token).

UPDATE_TOKEN є в Netlify env (Production) та був redeploy.

Запит із браузера має коректний Origin (див. CORS).

5.3. UUID vs text у import_batch_id

Підтримуються обидва формати.

Якщо не заданий — використовуйте sync_logs для відслідкування merge-операцій.

5.4. Матчі не з’являються у GET /matches

Перевір, що записи є у staging_matches.

Перевір sync_logs — був merge та які stats.

Переконайся, що унікальність (date_bucket, pair_key) не блокує вставку/оновлення.

6) Нотатки безпеки

Не комітити: токени, cookie-jar, тимчасові payload-файли.

Ротація: новий токен → оновити env → redeploy → прибрати старий.

CORS: приймаємо запити лише з APP_ORIGIN.

Деплой: пуші лише в main.

7) Критерії приймання (для цієї документації)

Файл docs/admin-ops.md існує в репозиторії (main), повністю заповнений.

Приклади команд (PowerShell/curl.exe) працюють на проді.

Перевірки (GET /matches, SQL у Neon) дають очікувані результати.

Жодних змін у коді/схемі в цьому кроці.

8) Додатки
8.1. curl.exe (Windows) без BOM
# Масив матчів
curl.exe -sS -X POST "$FN/import-to-staging" `
  -H "Content-Type: application/json" `
  --data-binary "[{""league"":""EPL"",""home_team"":""Arsenal"",""away_team"":""Chelsea"",""kickoff_at"":""2025-09-14T13:30:00Z"",""status"":""scheduled""}]"

# Ручний merge (Authorization Bearer)
curl.exe -sS -X POST "$FN/update-matches" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer %UPDATE_TOKEN%" `
  --data-binary "{\"trigger_type\":\"manual\",\"source\":\"ops\"}"


У cmd.exe перенос — ^. У PowerShell — бектик ` або один рядок.

Кінець документа.