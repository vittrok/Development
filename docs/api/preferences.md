# /preferences API

Єдиний ендпоінт для збереження та читання користувацьких преференсів:
- `seen_color` — колір підсвітки (рядок: `#RRGGBB`, `rgba(...)`, `hsl(...)` або css-колор).
- `sort_col`, `sort_order` — налаштування сортування списку матчів.

## Дозволені значення
- `sort_col`: `league`, `kickoff_at`
- `sort_order`: `asc`, `desc`

## Заголовки
- `Origin: https://football-m.netlify.app`
- `Cookie: sid=...` (авторизована сесія)
- **POST лише:** `X-CSRF: <HMAC_SHA256(CSRF_SECRET, sid)>` (hex, як повертає `/me`)

---

## GET /.netlify/functions/preferences

**Запит**
```bash
curl -sS "$FN/preferences" \
  -H "Origin: https://football-m.netlify.app" \
  --cookie "$CJ"

Відповідь

{
  "ok": true,
  "data": {
    "seen_color": "#ffeeaa",
    "sort_col": "league",
    "sort_order": "asc"
  }
}


POST /.netlify/functions/preferences

Підтримує application/json та application/x-www-form-urlencoded.
Рекомендовано для Windows/PowerShell використовувати --data-binary "@file" (щоб уникнути екранування).

JSON-приклад

echo '{"seen_color":"#ffeeaa","sort_col":"league","sort_order":"asc"}' > body.json
curl -i -sS "$FN/preferences" -X POST \
  -H "Origin: https://football-m.netlify.app" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Accept: application/json" \
  -H "X-CSRF: $CSRF" \
  --cookie "$CJ" \
  --data-binary "@body.json"


FORM-приклад

curl -i -sS "$FN/preferences" -X POST \
  -H "Origin: https://football-m.netlify.app" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Accept: application/json" \
  -H "X-CSRF: $CSRF" \
  --cookie "$CJ" \
  --data "seen_color=%23ffeeaa&sort_col=league&sort_order=asc"


Відповідь (успіх)

{
  "ok": true,
  "data": {
    "seen_color": "#ffeeaa",
    "sort_col": "league",
    "sort_order": "asc"
  }
}


Можливі помилки:
403 csrf_required_or_invalid — немає або неправильний CSRF.
400 invalid_json
400 invalid_seen_color | invalid_sort_col | invalid_sort_order
500 server_error


---

## Взаємодія з `/getMatches` та пагінація

Ендпоїнт `GET /.netlify/functions/getMatches` застосовує збережені префи:
- `sort_col`: `league` або `kickoff_at`
- `sort_order`: `asc` або `desc`
- Для анонімів дефолт: `{"sort_col":"kickoff_at","sort_order":"asc","seen_color":"#ffffcc"}`.
- Поля пагінації (`page.limit`, `page.offset`, `page.next_offset`, `page.has_more`) формуються **після** сортування.

### Приклад (авторизований сценарій)
```bash
# 1) /me → отримати CSRF
curl -sS "https://<origin>/.netlify/functions/me" \
  -H "Origin: https://<origin>" \
  --cookie "session=<sid>.<sig>"

# 2) Встановити префи: сортування за лігою (спадання)
echo '{"sort_col":"league","sort_order":"desc"}' > prefs.json
curl -i -sS "https://<origin>/.netlify/functions/preferences" -X POST \
  -H "Origin: https://<origin>" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "X-CSRF: <csrf>" \
  --cookie "session=<sid>.<sig>" \
  --data-binary "@prefs.json"

# 3) Пагінація (limit=5)
curl -i -sS "https://<origin>/.netlify/functions/getMatches?limit=5&offset=0" \
  -H "Origin: https://<origin>" --cookie "session=<sid>.<sig>"
curl -i -sS "https://<origin>/.netlify/functions/getMatches?limit=5&offset=5" \
  -H "Origin: https://<origin>" --cookie "session=<sid>.<sig>"

# 4) Очікування у відповіді getMatches:
"prefs": { "sort_col": "league", "sort_order": "desc", "seen_color": "..." },
"page":  { "limit": 5, "offset": 0, "next_offset": 5, "has_more": true }


