# dev/ops-auth-smoke.ps1
# Purpose: quick prod security smoke (CORS, token guard, optional login/me/logout).
# Compatible with Windows PowerShell 5.x (no Unicode/emoji in output).

param(
  [string]$FunctionsBase = "https://football-m.netlify.app/.netlify/functions",
  [string]$Origin       = $(if ($env:APP_ORIGIN) { $env:APP_ORIGIN } else { "https://football-m.netlify.app" }),
  [string]$UpdateToken  = $env:UPDATE_TOKEN,
  [string]$LoginJson    = ".\login.json"
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) { Write-Host "INFO: $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "OK  : $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "FAIL: $msg" -ForegroundColor Red }

function Get-JsonBody([string]$path) {
  if (Test-Path -LiteralPath $path) {
    try { return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json } catch { return $null }
  }
  return $null
}

Write-Info "Base URL: $FunctionsBase"
Write-Info "Origin  : $Origin"
if ($UpdateToken) { Write-Info "UPDATE_TOKEN: present" } else { Write-Info "UPDATE_TOKEN: missing (token tests will be skipped)" }

# 1) OPTIONS /update-matches
Write-Info "OPTIONS /update-matches (preflight)"
$opt = Invoke-WebRequest -Uri "$FunctionsBase/update-matches" -Method OPTIONS -Headers @{ "Origin" = $Origin } -MaximumRedirection 0
if (($opt.StatusCode -eq 200 -or $opt.StatusCode -eq 204) -and $opt.Headers.'Access-Control-Allow-Origin' -eq $Origin) {
  Write-Ok "Preflight OK (Status $($opt.StatusCode), ACAO=$($opt.Headers.'Access-Control-Allow-Origin'))"
} else {
  Write-Fail "Preflight failed (Status $($opt.StatusCode), ACAO=$($opt.Headers.'Access-Control-Allow-Origin'))"
  exit 1
}

# 2) POST /update-matches without token -> 401
Write-Info "POST /update-matches without token -> expect 401"
try {
  $r = Invoke-WebRequest -Uri "$FunctionsBase/update-matches" -Method POST `
        -Headers @{ "Origin"=$Origin; "Content-Type"="application/json" } `
        -Body '{ "trigger_type":"manual", "source":"ops-smoke" }' `
        -MaximumRedirection 0 -ErrorAction Stop
  Write-Fail "Expected 401 without token, got $($r.StatusCode)"
  exit 1
} catch {
  $resp = $_.Exception.Response
  if ($resp -and $resp.StatusCode -eq 401) {
    Write-Ok "Unauthorized as expected (401) without token"
  } else {
    $sc = if ($resp) { $resp.StatusCode } else { "no-response" }
    Write-Fail "Expected 401 without token, got $sc"
    exit 1
  }
}

# 3) POST /update-matches with WRONG token -> 401
Write-Info "POST /update-matches with WRONG token -> expect 401"
try {
  $r = Invoke-WebRequest -Uri "$FunctionsBase/update-matches" -Method POST `
        -Headers @{
          "Origin"=$Origin; "Content-Type"="application/json"
          "Authorization"="Bearer WRONGTOKEN"
        } -Body '{ "trigger_type":"manual", "source":"ops-smoke" }' `
        -MaximumRedirection 0 -ErrorAction Stop
  Write-Fail "Expected 401 with WRONG token, got $($r.StatusCode)"
  exit 1
} catch {
  $resp = $_.Exception.Response
  if ($resp -and $resp.StatusCode -eq 401) {
    Write-Ok "Unauthorized as expected (401) with WRONG token"
  } else {
    $sc = if ($resp) { $resp.StatusCode } else { "no-response" }
    Write-Fail "Expected 401 with WRONG token, got $sc"
    exit 1
  }
}

# 4) POST /update-matches with valid token -> 200
if ($UpdateToken) {
  Write-Info "POST /update-matches with valid token -> expect 200"
  $r = Invoke-WebRequest -Uri "$FunctionsBase/update-matches" -Method POST `
        -Headers @{
          "Origin"=$Origin; "Content-Type"="application/json"
          "Authorization"="Bearer $UpdateToken"
        } -Body '{ "trigger_type":"manual", "source":"ops-smoke" }' `
        -MaximumRedirection 0
  if ($r.StatusCode -eq 200) {
    Write-Ok "Authorized as expected (200) with valid token"
  } else {
    Write-Fail "Expected 200 with valid token, got $($r.StatusCode)"
    exit 1
  }
} else {
  Write-Info "Skipping valid token test (UPDATE_TOKEN not provided)"
}

# 5) Optional: login -> me -> logout (only if login.json exists and has username/password)
$creds = Get-JsonBody $LoginJson
if ($creds -and $creds.username -and $creds.password) {
  Write-Info "Login / Me / Logout smoke using $LoginJson"
  $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession

  # login
  $loginBody = @{ username = "$($creds.username)"; password = "$($creds.password)" } | ConvertTo-Json -Depth 4
  $lg = Invoke-WebRequest -Uri "$FunctionsBase/login" -Method POST `
        -ContentType "application/json; charset=utf-8" -Body $loginBody `
        -WebSession $sess -MaximumRedirection 0
  if ($lg.StatusCode -ne 200) { Write-Fail "Login status $($lg.StatusCode)"; exit 1 }

  # me (expect authenticated and csrf present)
  $me = Invoke-WebRequest -Uri "$FunctionsBase/me" -WebSession $sess
  $meJson = $me.Content | ConvertFrom-Json
  if (-not $meJson.ok -or -not $meJson.auth.isAuthenticated) {
    Write-Fail "/me not authenticated after login"
    exit 1
  }
  $csrf = $meJson.csrf
  if (-not $csrf) {
    Write-Fail "CSRF not returned by /me"
    exit 1
  }

  # logout (requires csrf headers)
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
  if ($me2Json.auth.isAuthenticated) { Write-Fail "/me still authenticated after logout"; exit 1 }

  Write-Ok "Login/Me/Logout flow OK"
} else {
  Write-Info "Skipping login/me/logout (file $LoginJson missing or incomplete)"
}

Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
exit 0
