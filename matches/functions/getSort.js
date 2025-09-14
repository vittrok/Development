// functions/getSort.js — legacy endpoint (soft-deprecated)
// Returns 410 Gone and points clients to /preferences

const APP_ORIGIN = process.env.APP_ORIGIN || "https://football-m.netlify.app";

function headers(json = true) {
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-CSRF, Cookie",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Cache-Control": "no-cache",
    "Content-Type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Deprecation": "true",
    // Sunset через 7 днів від сьогодні (2025-09-12 → 2025-09-19)
    "Sunset": "Fri, 19 Sep 2025 00:00:00 GMT",
    'Link': '</.netlify/functions/preferences>; rel="successor-version"'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: headers(), body: "" };
  }
  console.warn("[getSort] legacy endpoint hit; return 410");
  return {
    statusCode: 410,
    headers: headers(),
    body: JSON.stringify({ ok: false, error: "gone", use: "/.netlify/functions/preferences" })
  };
};
// return { statusCode: 410, headers: headers(false), body: "410 Gone: use /.netlify/functions/preferences" };