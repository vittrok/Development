$BASE = "matches/netlify-prod"

"## Tree ($BASE)"
Get-ChildItem -Path $BASE -File -Recurse -Depth 3 | ForEach-Object { $_.FullName.Replace("$BASE\", "") } | Sort-Object | Select-Object -First 300

"`n## netlify.toml"
if (Test-Path "$BASE/netlify.toml") { Get-Content "$BASE/netlify.toml" } else { "no netlify.toml in $BASE" }

"`n## Functions dir"
if (Test-Path "$BASE/netlify/functions") {
  Get-ChildItem -Path "$BASE/netlify/functions" -File -Recurse -Depth 2 | ForEach-Object { $_.FullName }
} else { "no functions dir" }

"`n## Look for SQL/migrations"
Select-String -Path "$BASE\**\*" -Pattern "CREATE TABLE|ALTER TABLE|PRIMARY KEY|UNIQUE|INDEX|ON CONFLICT" -AllMatches -SimpleMatch:$false | Select-Object -First 200

"`n## CSRF/cookie/session hints"
Select-String -Path "$BASE\**\*" -Pattern "csrf|SameSite|HttpOnly|Secure|Set-Cookie|cookie" -AllMatches -SimpleMatch:$false | Select-Object -First 200

"`n## Mentions of Neon/connection strings"
Select-String -Path "$BASE\**\*" -Pattern "neon|postgresql://|PGHOST|PGUSER|DATABASE_URL" -AllMatches -SimpleMatch:$false | Select-Object -First 200

"`n## Calls to serverless endpoints"
Select-String -Path "$BASE\**\*" -Pattern "/netlify/functions/|fetch\(" -AllMatches -SimpleMatch:$false | Select-Object -First 200

"`n## Security headers/CSP"
Select-String -Path "$BASE\**\*" -Pattern "Content-Security-Policy|Strict-Transport-Security|Referrer-Policy|Permissions-Policy|X-Content-Type-Options|X-Frame-Options" -AllMatches -SimpleMatch:$false | Select-Object -First 200
