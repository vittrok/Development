#!/usr/bin/env bash
set -euo pipefail
BASE="matches/netlify-prod"

echo "## Tree ($BASE)"
find "$BASE" -maxdepth 3 -type f | sed "s|^$BASE/||" | sort | sed -n '1,300p'

echo; echo "## netlify.toml"
[ -f "$BASE/netlify.toml" ] && cat "$BASE/netlify.toml" || echo "no netlify.toml in $BASE"

echo; echo "## Functions dir"
[ -d "$BASE/netlify/functions" ] && find "$BASE/netlify/functions" -maxdepth 2 -type f || echo "no functions dir"

echo; echo "## Look for SQL/migrations"
grep -RinE "CREATE TABLE|ALTER TABLE|PRIMARY KEY|UNIQUE|INDEX|ON CONFLICT" -- "$BASE" 2>/dev/null | sed -n '1,200p'

echo; echo "## CSRF/cookie/session hints"
grep -RinE "csrf|SameSite|HttpOnly|Secure|Set-Cookie|cookie" -- "$BASE" 2>/dev/null | sed -n '1,200p'

echo; echo "## Mentions of Neon/connection strings"
grep -RinE "neon|postgresql://|PGHOST|PGUSER|DATABASE_URL" -- "$BASE" 2>/dev/null | sed -n '1,200p'

echo; echo "## Calls to serverless endpoints"
grep -RinE "/netlify/functions/|fetch\\(" -- "$BASE" 2>/dev/null | sed -n '1,200p'

echo; echo "## Security headers/CSP"
grep -RinE "Content-Security-Policy|Strict-Transport-Security|Referrer-Policy|Permissions-Policy|X-Content-Type-Options|X-Frame-Options" -- "$BASE" 2>/dev/null | sed -n '1,200p'
