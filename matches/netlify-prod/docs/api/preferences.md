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



