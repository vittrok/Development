# GET /.netlify/functions/getMatches

Публічний read-only ендпоїнт, який повертає список матчів з урахуванням користувацьких преференсів сортування (аноніми отримують дефолти).

- **Метод:** `GET`
- **CORS:** Доступний з `APP_ORIGIN` (див. `docs/security-overview.md`)
- **CSRF:** Не потрібен (read-only)
- **Авторизація:** Не обов’язкова. Якщо у запиті присутній валідний cookie `session`, преференси беруться з `user_preferences.data`; інакше — застосовуються дефолти.

## Параметри запиту

| Параметр | Тип   | Діапазон / Значення | Дефолт | Опис |
|---------:|:-----:|:---------------------|:------:|:-----|
| `limit`  | int   | `1..200`             | `50`   | К-сть рядків на сторінку. Значення поза діапазоном нормалізуються (див. нижче). |
| `offset` | int   | `>= 0`               | `0`    | Зсув у результуючій вибірці. Від’ємні значення нормалізуються до `0`. |

### Нормалізація параметрів
- Нечислові (`abc`) або невалідні значення перетворюються у безпечні дефолти.
- `limit <= 0` → `50`
- `limit > 200` → `200`
- `offset < 0` → `0`

## Сортування
Сортування визначається преференсами користувача:
- `sort_col` ∈ `{ kickoff_at, home_team, away_team, tournament, status, league }`  
- `sort_order` ∈ `{ asc, desc }`

## Для анонімів використовується дефолт:
```json
{ "sort_col": "kickoff_at", "sort_order": "asc", "seen_color": "#ffffcc" }
```

## Формат відповіді
```json
{
  "ok": true,
  "items": [
    {
      "id": "string",
      "kickoff_at": "ISO8601",
      "home_team": "string",
      "away_team": "string",
      "tournament": "string|null",
      "status": "string",
      "league": "string"
    }
  ],
  "prefs": {
    "sort_col": "kickoff_at|home_team|away_team|tournament|status|league",
    "sort_order": "asc|desc",
    "seen_color": "#rrggbb"
  },
  "page": {
    "limit": 50,
    "offset": 0,
    "next_offset": 50,
    "has_more": true
  }
}
```

## Пояснення page
    limit — фактично застосоване значення (враховуючи нормалізацію).
    offset — фактично застосоване значення.
    next_offset — значення, яке слід передати в наступному запиті, щоб отримати наступну порцію даних: offset + items.length.
    has_more — true, якщо існує наступна сторінка (використовується техніка limit+1 у запиті до БД).

## Приклади
1) Дефолтні параметри (анонім)
curl -sS "https://<origin>/.netlify/functions/getMatches" \
  -H "Origin: https://<origin>" \
  -H "Accept: application/json"

2) Перші 5 елементів, далі пагінація за next_offset
# сторінка 1
curl -sS "https://<origin>/.netlify/functions/getMatches?limit=5&offset=0" \
  -H "Origin: https://<origin>" -H "Accept: application/json"

# сторінка 2
curl -sS "https://<origin>/.netlify/functions/getMatches?limit=5&offset=5" \
  -H "Origin: https://<origin>" -H "Accept: application/json"

3) Нормалізація сміттєвих значень
curl -sS "https://<origin>/.netlify/functions/getMatches?limit=abc&offset=zzz" \
  -H "Origin: https://<origin>" -H "Accept: application/json"
# → "limit": 50, "offset": 0


---

## Пагінація та преференси ( `/getMatches` )

`GET /.netlify/functions/getMatches` підтримує пагінацію й застосовує збережені префи сортування **авторизованого** користувача.

### Параметри пагінації

- `limit` — к-сть рядків на сторінку. Діапазон: **1..200**. Дефолт: **50**. Значення поза діапазоном нормалізуються (0 → 50, 9999 → 200).
- `limit` — к-сть рядків на сторінку. Діапазон: `1..200`. Значення поза діапазоном нормалізуються (мінімум 1, максимум 200).

- `offset` — зміщення (0, 5, 10, …). Від’ємні значення нормалізуються до **0**. Дуже великий `offset` → `items: []`, `has_more: false`, `next_offset == offset`.

### Застосування префів
- Для авторизованого користувача використовується збережене сортування з `/preferences`:
  - `sort_col`: `league` або `kickoff_at`
  - `sort_order`: `asc` або `desc`
- Для анонімів діє дефолт:
  ```json
  { "sort_col": "kickoff_at", "sort_order": "asc", "seen_color": "#ffffcc" }
  ```

- Після сортування застосовується відсікання за limit і формується page:
```json
"page": { "limit": <n>, "offset": <m>, "next_offset": <m+n>, "has_more": <bool> }
```

### Приклад (авторизований сценарій)
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

### Очікування у відповіді getMatches:
```json
"prefs": { "sort_col": "league", "sort_order": "desc", "seen_color": "..." },
"page":  { "limit": 5, "offset": 0, "next_offset": 5, "has_more": true }
```