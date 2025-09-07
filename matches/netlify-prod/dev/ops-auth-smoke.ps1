<#
  dev/ops-auth-smoke.ps1
  Призначення: швидка перевірка безпеки на проді (CORS, токени, login/me/logout).
  Без змін у коді. Нічого не комітить/не модифікує на сервері, лише читає/викликає API.
#>

param(
  [string]$FunctionsBase = "https://football-m.netlify.app/.netlify/functions",
  [string]$Origin       = $(if ($env:APP_ORIGIN) { $env:APP_ORIGIN } else { "https://football-m.netlify.app" }),
  [string]$UpdateToken  = $env:UPDATE_TOKEN,
  [string]$LoginJson    = ".\login.json",              # опц.: {"username":"...","password":"..."}
  [string]$CookieJar    = ".\dev\fixtures\cookies.txt" # для curl-сценаріїв (опц., тут не обов'язково)
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) { Write-Host "ℹ $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "OK  $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "FAIL $msg" -ForegroundColor Red }

function Get-JsonBody([string]$path) {
  if (Test-Path $path) {
    return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
  }
  return $null
}

# -----------------------------
# 0) Підготовка
# -----------------------------
Write-Info "Base: $FunctionsBase"
Write-Info "Origin: $Origin"
if ($UpdateToken) { Write-Info "UPDATE_TOKEN: (present)" } else { Write-Info "UPDATE_TOKEN: (missing — кроки з токеном буде пропущено)" }

# -----------------------------
# 1) Preflight OPTIONS /update-matches
# -----------------------------
Write-Info "OPTIONS /update-matches (preflight)"
$opt = Invoke-WebRequest -Uri "$FunctionsBase/update-matches" -Method OPTIONS -Headers @{ "Origin" = $Origin } -MaximumRedirection 0
if ($opt.StatusCode -in 200,204 -and $opt.Headers.'Access-Control-Allow-Origin' -eq $Origin) {
  Write-Ok "Preflight OK (Status $($opt.StatusCode), ACAO=$Origin)"
} else {
  Write-Fail "Preflight: очікував 200/204 і ACAO=$Origin"; exit 1
}

# -----------------------------
# 2) POST /update-matches БЕЗ токена → 401
# -----------------------------
Write-Info "POST /update-matches без токена → очікуємо 401"
try {
  $r = Invoke-WebRequest -Uri "$FunctionsBase/update-matches" -Method POST `
        -Headers @{ "Origin"=$Origin; "Content-Type"="application/json" } `
        -Body '{ "trigger_type":"manual", "source":"ops-smoke" }' `
        -MaximumRedirection 0
  Write-Fail "Без токена не мало бути 200 (отримано $($r.StatusCode))"; exit 1
} catch {
  $resp = $_.Exception.Response
  if ($resp -and $resp.StatusCode -eq 401) {
    Write-Ok "Без токена → 401 як очікували"
  } else {
    Write-Fail "Без токена очікували 401; отримано: $($resp.StatusCode)"; exit 1
  }
}

# -----------------------------
# 3) POST /update-matches з WRONG токеном → 401
# -----------------------------
Write-Info "POST /update-matches з неправильним токеном → очікуємо 401"
try {
  $r = Invoke-WebRequest -Uri "$FunctionsBase/update-matches" -Method POST `
        -Headers @{
          "Origin"=$Origin; "Content-Type"="application/json"
          "Authorization"="Bearer WRONGTOKEN"
        } -Body '{ "trigger_type":"manual", "source":"ops-smoke" }' `
        -MaximumRedirection 0
  Write-Fail "З WRONG токеном не мало бути 200 (отримано $($r.StatusCode))"; exit 1
} catch {
  $resp = $_.Exception.Response
  if ($resp -and $resp.StatusCode -eq 401) {
    Write-Ok "WRONG токен → 401 як очікували"
  } else {
    Write-Fail "WRONG токен очікували 401; отримано: $($resp.StatusCode)"; exit 1
  }
}

# -----------------------------
# 4) POST /update-matches з вірним токеном → 200
# -----------------------------
if ($UpdateToken) {
  Write-Info "POST /update-matches з валідним токеном → очікуємо 200"
  $r = Invoke-WebRequest -Uri "$FunctionsBase/update-matches" -Method POST `
        -Headers @{
          "Origin"=$Origin; "Content-Type"="application/json"
          "Authorization"="Bearer $UpdateToken"
        } -Body '{ "trigger_type":"manual", "source":"ops-smoke" }' `
        -MaximumRedirection 0
  if ($r.StatusCode -eq 200) {
    Write-Ok "Валідний токен → 200 OK"
  } else {
    Write-Fail "З валідним токеном очікували 200; отримано $($r.StatusCode)"; exit 1
  }
} else {
  Write-Info "Пропускаємо крок із валідним токеном (UPDATE_TOKEN відсутній у середовищі)"
}

# -----------------------------
# 5) (Опціонально) login → me → logout (якщо є login.json)
# -----------------------------
$creds = Get-JsonBody $LoginJson
if ($creds -and $creds.username -and $creds.password) {
  Write-Info "Login/Me/Logout smoke (з $LoginJson)"
  $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession

  # login
  $loginBody = @{
    username = "$($creds.username)"
    password = "$($creds.password)"
  } | ConvertTo-Json -Depth 4
  $lg = Invoke-WebRequest -Uri "$FunctionsBase/login" -Method POST `
        -ContentType "application/json; charset=utf-8" -Body $loginBody `
        -WebSession $sess -MaximumRedirection 0
  if ($lg.StatusCode -ne 200) { Write-Fail "Login status $($lg.StatusCode)"; exit 1 }

  # me (із CSRF)
  $me = Invoke-WebRequest -Uri "$FunctionsBase/me" -WebSession $sess
  $meJson = $me.Content | ConvertFrom-Json
  if (-not $meJson.ok -or -not $meJson.auth.isAuthenticated) {
    Write-Fail "/me неавтентифікований після login"; exit 1
  }
  $csrf = $meJson.csrf
  if (-not $csrf) { Write-Fail "CSRF не виданий у /me"; exit 1 }

  # logout
  $headers = @{
    "X-CSRF"           = $csrf
    "Origin"           = $Origin
    "X-Requested-With" = "XMLHttpRequest"
    "Content-Type"     = "application/json"
  }
  try {
    $lo = Invoke-WebRequest -Uri "$FunctionsBase/logout" -Method POST -Headers $headers -Body "{}" -WebSession $sess -MaximumRedirection 0 -ErrorAction Stop
  } catch {
    $lo = $_.Exception.Response
  }
  if ($lo.StatusCode -ne 200) { Write-Fail "Logout status $($lo.StatusCode)"; exit 1 }

  $me2 = Invoke-WebRequest -Uri "$FunctionsBase/me" -WebSession $sess
  $me2Json = $me2.Content | ConvertFrom-Json
  if ($me2Json.auth.isAuthenticated) { Write-Fail "/me після logout все ще автентифікований"; exit 1 }

  Write-Ok "Login/Me/Logout OK"
} else {
  Write-Info "Пропускаємо login/me/logout (файл $LoginJson відсутній або неповний)"
}

Write-Host "ALL CHECKS PASSED ✅" -ForegroundColor Green
exit 0
