# Security Overview

## CSRF
POST-запити вимагають заголовок:
`X-CSRF = HMAC_SHA256(CSRF_SECRET, sid)` (hex), де `sid` — значення з cookie сесії.

Алгоритм:
1. Клієнт викликає `GET /.netlify/functions/me` → отримує `csrf` (бекенд обчислює HMAC по `sid`).
2. Для кожного state-changing запиту клієнт додає `X-CSRF: <csrf>`.
3. Бекенд звіряє хеш за `sid` з куки та `CSRF_SECRET`.

## CORS
- Origin: https://football-m.netlify.app
- Access-Control-Allow-Credentials: true
- Allow-Methods: GET,POST,OPTIONS
- Allow-Headers: Content-Type, X-Requested-With, X-CSRF, Cookie
