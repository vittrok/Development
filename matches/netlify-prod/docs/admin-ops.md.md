# Admin Operations (staging → merge) — інструкції

**Версія:** 18.2  
**Останнє оновлення:** 2025-09-07  
**Аудиторія:** оператори/адміни проєкту  
**Мета:** безпечний імпорт у `staging`, ручний/плановий merge у `matches`, перевірки та траблшутінг — **без змін у коді**.

---

## 0) Політики та рамки

- **Гілка/деплой:** пуші **лише** в `main` → production. Рухаємося дрібними кроками, не ламаємо наявні дані.  
- **Без “spoilers”:** публічний `GET /matches` **не містить** полів рахунку (`home_score/away_score`).  
- **CORS:** дозволений origin задається `APP_ORIGIN` (env).  
- **Секрети:** усі токени/паролі — **тільки** в Netlify env. Не комітити у репозиторій.  
- **Канон БД:** унікальність `matches` за `(date_bucket, pair_key)`; шлях: `staging_matches` → валідація/канонізація → ідемпотентний merge → логи в `sync_logs`.

---

## 1) Секрети / ENV

### 1.1. `UPDATE_TOKEN` — довгий секрет для адмін-операцій

Використовується у:
- `POST /.netlify/functions/import-to-staging`
- `POST /.netlify/functions/update-matches`

**Згенерувати в PowerShell (Base64URL, 48 байт ≈ 384 біт):**
```powershell
$b = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$b64 = [Convert]::ToBase64String($b)
($b64.TrimEnd('=')) -replace '\+','-' -replace '/','_'
